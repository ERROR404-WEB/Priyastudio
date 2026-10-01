import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '../schema';
import { migrationStatements } from '../migrations';
import { parseShoot } from '../../lib/calendar';
import { CalendarRepository } from './repository';
import { DemoCalendarRepository } from './demo';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const repo = new CalendarRepository(db);
const input = parseShoot({ id: 'shoot', collaborationId: 'work', startsAt: '2026-10-03T09:00:00+05:30', endsAt: '2026-10-03T10:00:00+05:30' }, [{ id: 'work', title: 'Visit' }]);
beforeAll(async () => {
  for (let run = 0; run < 2; run++) for (const file of ['0000_studio.sql', '0001_calendar.sql', '0002_calendar_validation.sql']) {
    for (const statement of migrationStatements(await readFile(new URL(`../../../drizzle/${file}`, import.meta.url), 'utf8'))) await pg.exec(statement);
  }
}, 30_000);
afterAll(() => pg.close());

describe('real PostgreSQL calendar storage', () => {
  it('retains one schedule per owner/id and rejects stale reschedules without losing the winner', async () => {
    const first = await repo.save('cas-owner', input, 0);
    expect(first.shoot).toMatchObject({ revision: 1, status: 'pending', title: 'Visit' });
    const attempts = await Promise.allSettled(['First update', 'Second update'].map((title) => repo.save('cas-owner', { ...input, title }, 1)));
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.list('cas-owner'))).toHaveLength(1);
    expect((await repo.get('cas-owner', 'shoot'))?.shoot.revision).toBe(2);
    expect(await repo.get('other-owner', 'shoot')).toBeNull();
    await expect(repo.save('cas-owner', { ...input, title: 'stale' }, 0)).rejects.toMatchObject({ status: 409 });
  });
  it('accepts a replay of the same saved payload but never resurrects a cancelled schedule', async () => {
    await repo.save('replay-owner', input, 0);
    expect((await repo.save('replay-owner', input, 0)).shoot.revision).toBe(1);
    expect((await repo.cancel('replay-owner', 'shoot', 1)).shoot).toMatchObject({ cancelled: true, status: 'pending', revision: 2 });
    expect((await repo.cancel('replay-owner', 'shoot', 1)).shoot.revision).toBe(2);
    await expect(repo.save('replay-owner', input, 2)).rejects.toMatchObject({ status: 409 });
  });
  it('leases serialize independent repository instances and fence expired owners and stale revisions', async () => {
    await repo.save('lease-owner', input, 0);
    const other = new CalendarRepository(db);
    const leases = await Promise.all([repo.claim('lease-owner'), other.claim('lease-owner')]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const lease = leases.find(Boolean)!;
    const old = (await repo.get('lease-owner', 'shoot'))!;
    await repo.save('lease-owner', { ...input, title: 'Latest' }, 1);
    expect(await repo.finish(lease, old, 'synced', null)).toBe(false);
    await db.execute(sql`UPDATE calendar_connection SET lease_until = now() - interval '1 second' WHERE owner_id = 'lease-owner'`);
    const replacement = (await other.claim('lease-owner'))!;
    expect(replacement.token).not.toBe(lease.token);
    expect(await repo.valid(lease)).toBe(false);
    await repo.release(lease);
    expect(await other.valid(replacement)).toBe(true);
    expect(await repo.finish(lease, (await repo.get('lease-owner', 'shoot'))!, 'synced', null)).toBe(false);
    await other.release(replacement);
  });
  it('disconnect invalidates pending OAuth/sync and cannot remove replacement credentials', async () => {
    const lease = (await repo.claim('connection-owner'))!;
    await repo.disconnect('connection-owner', false);
    expect(await repo.link(lease, 'ciphertext')).toBe(false);
    expect(await repo.valid(lease)).toBe(false);
    await repo.release(lease);
    await repo.endDisconnect('connection-owner', 1);
    const next = (await repo.claim('connection-owner'))!;
    expect(await repo.link(next, 'new-ciphertext')).toBe(true);
    expect(await repo.replaceCredentials(lease, 'old-ciphertext')).toBe(false);
    expect((await repo.connection('connection-owner')).credentials).toBe('new-ciphertext');
    expect(await repo.disconnect('connection-owner', true, 0)).toBeNull();
    expect((await repo.connection('connection-owner')).credentials).toBe('new-ciphertext');
    await repo.release(next);
  });
  it('enforces database invariants even if application validation is bypassed', async () => {
    await repo.save('constraints-owner', input, 0);
    await expect(db.execute(sql`UPDATE calendar_shoot SET revision = -1 WHERE owner_id = 'constraints-owner'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE calendar_shoot SET event_generation = -1 WHERE owner_id = 'constraints-owner'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE calendar_shoot SET body = jsonb_set(body, '{timeZone}', '"UTC"') WHERE owner_id = 'constraints-owner'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE calendar_shoot SET body = '{}' WHERE owner_id = 'constraints-owner'`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE calendar_shoot SET body = jsonb_set(body, '{status}', '"invented"') WHERE owner_id = 'constraints-owner'`)).rejects.toThrow();
  });
  it.each<[string, unknown]>([
    ['empty object', {}], ['array', []], ['JSON null', null],
    ...['id', 'collaborationId', 'title', 'startsAt', 'endsAt', 'timeZone', 'location', 'reminderMinutes', 'revision', 'cancelled', 'status', 'error'].map<[string, unknown]>((key) => [
      `missing ${key}`, Object.fromEntries(Object.entries({ ...input, revision: 1, cancelled: false, status: 'pending', error: null }).filter(([name]) => name !== key)),
    ]),
    ...[
      { status: 'invented' }, { status: null }, { cancelled: 'false' }, { cancelled: null },
      { revision: '1' }, { revision: null }, { collaborationId: 2 }, { title: [] },
      { location: {} }, { error: 1 }, { reminderMinutes: null }, { reminderMinutes: '60' },
      { reminderMinutes: [-1] }, { reminderMinutes: [40321] }, { reminderMinutes: [1.5] },
      { reminderMinutes: ['60'] }, { reminderMinutes: [1, 2, 3, 4, 5, 6] },
      { startsAt: null }, { endsAt: null }, { startsAt: 'yesterday' },
      { status: 'cancelled', cancelled: false }, { status: 'synced', cancelled: true },
      { accessToken: 'must-not-be-stored-in-shoots' },
    ].map<[string, unknown]>((change) => [JSON.stringify(change), { ...input, revision: 1, cancelled: false, status: 'pending', error: null, ...change }]),
  ])('rejects malformed persisted shoot: %s', async (label, body) => {
    const owner = `shape-${label}`;
    await repo.save(owner, input, 0);
    await expect(db.execute(sql`UPDATE calendar_shoot SET body = ${JSON.stringify(body)}::jsonb WHERE owner_id = ${owner}`)).rejects.toThrow();
    expect((await repo.get(owner, input.id))?.shoot).toMatchObject({ title: 'Visit', status: 'pending' });
  });
});

describe('separate local demo schedules', () => {
  it('persists schedules across instances without Google credentials or aggregate data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calendar-demo-'));
    try {
      const path = join(directory, 'calendar.json');
      const local = new DemoCalendarRepository(path);
      await local.save(input, 0);
      expect((await new DemoCalendarRepository(path).list())[0]).toMatchObject({ title: 'Visit', status: 'pending' });
      await local.cancel('shoot', 1);
      expect((await local.list())[0]).toMatchObject({ status: 'cancelled', cancelled: true });
      expect(await readFile(path, 'utf8')).not.toMatch(/credentials|refreshToken|accessToken|invoices|secret/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});