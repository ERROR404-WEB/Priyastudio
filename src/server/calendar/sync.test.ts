import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventId } from '../../lib/calendar';
import { CalendarService } from './service';
import { CalendarOAuth } from './oauth';
import { calendarDatabase, config, deferred, FakeGoogle } from './test-helpers';
import { decrypt } from './crypto';
import { GoogleFailure } from './google';
import { sql } from 'drizzle-orm';

let database: Awaited<ReturnType<typeof calendarDatabase>>;
beforeAll(async () => { database = await calendarDatabase(); }, 30_000);
afterAll(async () => { await database.pg.close(); });
const collaborations = [{ id: 'work', title: 'Brand visit' }];
const input = { id: 'shoot', collaborationId: 'work', startsAt: '2026-10-03T09:00:00+05:30', endsAt: '2026-10-03T10:00:00+05:30', location: 'Private location' };
async function connected(owner: string) {
  const google = new FakeGoogle();
  const oauth = new CalendarOAuth(database.repo, config, google);
  const start = await oauth.begin(owner);
  await oauth.complete(owner, start.browser, { state: new URL(start.url).searchParams.get('state')!, code: 'test-code' });
  return { google, service: new CalendarService(database.repo, config, google) };
}
const active = (google: FakeGoogle) => [...google.events.values()].filter((event) => event.status !== 'cancelled');

describe('durable save and real sync orchestration', () => {
  it('saves before external IO and recovers a lost create response without duplicating the event', async () => {
    const { google, service } = await connected('lost-response');
    google.loseCreateResponse = true;
    google.beforeEvent = async () => { expect((await database.repo.get('lost-response', 'shoot'))?.shoot.title).toBe('Brand visit'); };
    expect((await service.save('lost-response', input, 0, collaborations)).shoots[0]).toMatchObject({ status: 'error', revision: 1 });
    expect(active(google)).toHaveLength(1);
    expect((await service.retry('lost-response', 'shoot')).shoots[0].status).toBe('synced');
    expect(active(google)).toHaveLength(1);
    expect(JSON.stringify(await service.view('lost-response'))).not.toMatch(/fixture-access|fixture-refresh|credentials|namespace|eventGeneration/);
  });
  it('persists reschedules and retries cancellation until Google deletion succeeds', async () => {
    const { google, service } = await connected('cancel-retry');
    await service.save('cancel-retry', input, 0, collaborations);
    const id = active(google)[0].id;
    await service.save('cancel-retry', { ...input, title: 'Moved visit', startsAt: '2026-10-04T09:00:00+05:30', endsAt: '2026-10-04T10:00:00+05:30' }, 1, collaborations);
    expect(active(google)).toHaveLength(1);
    expect(active(google)[0]).toMatchObject({ id, summary: 'Moved visit' });
    google.failDelete = true;
    expect((await service.cancel('cancel-retry', 'shoot', 2)).shoots[0]).toMatchObject({ cancelled: true, status: 'error', revision: 3 });
    google.failDelete = false;
    expect((await service.retry('cancel-retry', 'shoot')).shoots[0].status).toBe('cancelled');
    expect(active(google)).toHaveLength(0);
  });
  it('handles 409 by verifying ownership, never overwriting a foreign event', async () => {
    const { google, service } = await connected('foreign-event');
    google.beforeEvent = async (request) => {
      if (request.method === 'POST') google.events.set(request.id, { id: request.id, etag: '"foreign"', summary: 'Do not change me' });
    };
    expect((await service.save('foreign-event', input, 0, collaborations)).shoots[0].status).toBe('error');
    expect(active(google)[0].summary).toBe('Do not change me');
    expect(google.requests.filter((request) => ['PATCH', 'DELETE'].includes(request.method))).toHaveLength(0);
  });
  it('recovers an owned 409 and an ETag conflict with a fresh verified read', async () => {
    const { google, service } = await connected('etag-conflict');
    let insertRace = true; let updateRace = true;
    google.beforeEvent = async (request) => {
      if (request.method === 'POST' && insertRace) {
        insertRace = false;
        google.events.set(request.id, { ...request.body, id: request.id, etag: '"racing-create"' });
      } else if (request.method === 'PATCH' && updateRace) {
        updateRace = false; google.events.get(request.id)!.etag = '"racing-update"';
      }
    };
    expect((await service.save('etag-conflict', input, 0, collaborations)).shoots[0].status).toBe('synced');
    expect(active(google)).toHaveLength(1);
    expect(google.requests.filter((request) => request.method === 'PATCH').map((request) => request.etag)).toEqual(['"racing-create"', '"racing-update"']);
  });
  it('recreates a Google-deleted event with a durably advanced ID generation', async () => {
    const { google, service } = await connected('deleted-event');
    await service.save('deleted-event', input, 0, collaborations);
    const old = active(google)[0];
    google.events.set(old.id, { id: old.id, etag: '"deleted"', status: 'cancelled' });
    expect((await service.retry('deleted-event', 'shoot')).shoots[0].status).toBe('synced');
    const connection = await database.repo.connection('deleted-event');
    expect((await database.repo.get('deleted-event', 'shoot'))?.eventGeneration).toBe(1);
    expect(active(google)[0].id).toBe(eventId(connection.namespace, 'shoot', 1));
  });
  it('keeps a newer save pending during an older request, then syncs the latest revision', async () => {
    const { google, service } = await connected('concurrent-save');
    await service.save('concurrent-save', input, 0, collaborations);
    const entered = deferred(); const release = deferred(); let once = true;
    google.beforeEvent = async (request) => {
      if (request.method === 'PATCH' && once) { once = false; entered.resolve(); await release.promise; }
    };
    const older = service.save('concurrent-save', { ...input, title: 'Older' }, 1, collaborations);
    await entered.promise;
    const other = new CalendarService(database.repo, config, google);
    expect((await other.save('concurrent-save', { ...input, title: 'Newest' }, 2, collaborations)).shoots[0]).toMatchObject({ title: 'Newest', status: 'pending', revision: 3 });
    release.resolve(); await older;
    expect((await service.view('concurrent-save')).shoots[0]).toMatchObject({ title: 'Newest', status: 'synced' });
    expect(active(google)[0]).toMatchObject({ summary: 'Newest', extendedProperties: { private: { revision: '3' } } });
  });
  it('refreshes under the durable lease and persists encrypted replacement tokens', async () => {
    const { google, service } = await connected('refresh-owner');
    const connection = await database.repo.connection('refresh-owner');
    const lease = (await database.repo.claim('refresh-owner'))!;
    const { encrypt } = await import('./crypto');
    const oldTokens = { ...google.tokens, expiresAt: 1 };
    await database.repo.replaceCredentials(lease, encrypt(JSON.stringify(oldTokens), config.encryptionKey, `credentials:refresh-owner:${connection.epoch}`));
    await database.repo.release(lease);
    expect((await service.save('refresh-owner', input, 0, collaborations)).shoots[0].status).toBe('synced');
    expect(google.refreshes).toBe(1);
    const current = await database.repo.connection('refresh-owner');
    expect(JSON.parse(decrypt(current.credentials!, config.encryptionKey, `credentials:refresh-owner:${current.epoch}`)).accessToken).toBe('refreshed-access');
  });
  it('removes revoked tokens and requires reconnect instead of pretending sync worked', async () => {
    const { google, service } = await connected('revoked-owner'); google.revoked = true;
    const result = await service.save('revoked-owner', input, 0, collaborations);
    expect(result).toMatchObject({ connected: false, reconnectRequired: true });
    expect(result.shoots[0].status).not.toBe('synced');
    expect((await database.repo.connection('revoked-owner')).credentials).toBeNull();
  });
  it('disconnect fences an in-flight sync and revokes the grant without deleting any events', async () => {
    const { google, service } = await connected('disconnect-sync');
    await service.save('disconnect-sync', input, 0, collaborations);
    google.events.set('unrelated', { id: 'unrelated', etag: '"private"' });
    const entered = deferred(); const release = deferred();
    google.beforeEvent = async (request) => { if (request.method === 'PATCH') { entered.resolve(); await release.promise; } };
    const pending = service.save('disconnect-sync', { ...input, title: 'In flight' }, 1, collaborations);
    await entered.promise;
    expect((await service.disconnect('disconnect-sync')).connected).toBe(false);
    release.resolve(); await pending;
    expect((await service.view('disconnect-sync')).shoots[0].status).not.toBe('synced');
    expect((await database.repo.connection('disconnect-sync')).credentials).toBeNull();
    expect(google.revocations).toEqual(['fixture-refresh']);
    expect(google.requests.some((request) => request.method === 'DELETE')).toBe(false);
    expect(google.events.has('unrelated')).toBe(true);
  });
  it('persists planning when Google is unconfigured and rejects retry honestly', async () => {
    const service = new CalendarService(database.repo, null, null);
    expect(await service.save('not-configured', input, 0, collaborations)).toMatchObject({ configured: false, connected: false, demo: false, shoots: [{ status: 'pending' }] });
    await expect(service.retry('not-configured', 'shoot')).rejects.toMatchObject({ status: 503 });
    await expect(service.save('not-configured', { ...input, collaborationId: 'missing' }, 1, collaborations)).rejects.toMatchObject({ status: 422 });
  });
  it('keeps disconnect available if owner setup disappears without claiming stored events are synced', async () => {
    const { service } = await connected('setup-removed');
    await service.save('setup-removed', input, 0, collaborations);
    const unavailable = new CalendarService(database.repo, null, null);
    const view = await unavailable.view('setup-removed');
    expect(view).toMatchObject({ configured: false, connected: true });
    expect(view.shoots[0].status).toBe('pending');
    expect((await unavailable.disconnect('setup-removed')).notice).toContain('revocation could not be confirmed');
    expect((await database.repo.connection('setup-removed')).credentials).toBeNull();
  });
  it('fences an expired worker and its delayed ETag write after another instance syncs a newer revision', async () => {
    const { google, service } = await connected('expired-worker');
    await service.save('expired-worker', input, 0, collaborations);
    const entered = deferred(); const release = deferred(); let once = true;
    google.beforeEvent = async (request) => { if (request.method === 'PATCH' && once) { once = false; entered.resolve(); await release.promise; } };
    const old = service.save('expired-worker', { ...input, title: 'Old worker' }, 1, collaborations);
    await entered.promise;
    await database.db.execute(sql`UPDATE calendar_connection SET lease_until = now() - interval '1 second' WHERE owner_id = 'expired-worker'`);
    const other = new CalendarService(database.repo, config, google);
    expect((await other.save('expired-worker', { ...input, title: 'Replacement worker' }, 2, collaborations)).shoots[0].status).toBe('synced');
    release.resolve(); await old;
    expect(active(google)[0].summary).toBe('Replacement worker');
    expect((await service.view('expired-worker')).shoots[0]).toMatchObject({ revision: 3, status: 'synced', title: 'Replacement worker' });
  });
  it('cannot restore credentials when a refresh response arrives after disconnect', async () => {
    const { google, service } = await connected('stale-refresh');
    // A 401 exercises the refresh path without changing core token handling.
    google.revoked = true;
    const entered = deferred(); const release = deferred();
    google.beforeRefresh = async () => { entered.resolve(); await release.promise; google.revoked = false; };
    const pending = service.save('stale-refresh', input, 0, collaborations);
    await entered.promise; await service.disconnect('stale-refresh'); release.resolve(); await pending;
    expect((await database.repo.connection('stale-refresh')).credentials).toBeNull();
    expect(active(google)).toHaveLength(0);
  });
  it('cannot invalidate a replacement worker after an expired refresh rejects', async () => {
    const { google, service } = await connected('expired-refresh');
    google.revoked = true;
    const entered = deferred(); const release = deferred(); let once = true;
    google.beforeRefresh = async () => {
      if (once) { once = false; entered.resolve(); await release.promise; throw new GoogleFailure(true); }
    };
    const old = service.save('expired-refresh', input, 0, collaborations);
    await entered.promise;
    await database.db.execute(sql`UPDATE calendar_connection SET lease_until = now() - interval '1 second' WHERE owner_id = 'expired-refresh'`);
    google.revoked = false;
    const replacement = new CalendarService(database.repo, config, google);
    expect((await replacement.retry('expired-refresh', 'shoot')).shoots[0].status).toBe('synced');
    release.resolve(); await old;
    expect(await replacement.view('expired-refresh')).toMatchObject({ connected: true, reconnectRequired: false, shoots: [{ status: 'synced' }] });
    expect((await database.repo.connection('expired-refresh')).credentials).not.toBeNull();
  });
  it('removes tampered credentials and leaves a recoverable reconnect state', async () => {
    const { google, service } = await connected('tampered-credentials');
    await database.db.execute(sql`UPDATE calendar_connection SET credentials = 'v1.invalid.invalid.invalid' WHERE owner_id = 'tampered-credentials'`);
    const view = await service.save('tampered-credentials', input, 0, collaborations);
    expect(view).toMatchObject({ connected: false, reconnectRequired: true });
    expect(google.requests).toHaveLength(0);
    expect((await database.repo.connection('tampered-credentials')).credentials).toBeNull();
  });
  it('never deletes events with foreign markers, a newer revision, or guests', async () => {
    for (const scenario of ['foreign', 'newer', 'guests']) {
      const owner = `unsafe-delete-${scenario}`;
      const { google, service } = await connected(owner);
      await service.save(owner, input, 0, collaborations);
      const event = active(google)[0];
      if (scenario === 'foreign') event.extendedProperties!.private!.owner = 'another-app-owner';
      if (scenario === 'newer') event.extendedProperties!.private!.revision = '99';
      if (scenario === 'guests') event.attendees = [{ email: 'not-invited-by-app@example.test' }];
      expect((await service.cancel(owner, 'shoot', 1)).shoots[0].status).toBe('error');
      expect(active(google)).toHaveLength(1);
      expect(google.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0);
    }
  });
});