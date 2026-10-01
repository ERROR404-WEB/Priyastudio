import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { CalendarOAuth } from './oauth';
import { decrypt } from './crypto';
import { calendarDatabase, config, deferred, FakeGoogle } from './test-helpers';

let database: Awaited<ReturnType<typeof calendarDatabase>>;
beforeAll(async () => { database = await calendarDatabase(); }, 30_000);
afterAll(async () => { await database.pg.close(); });
const service = (google = new FakeGoogle()) => ({ google, oauth: new CalendarOAuth(database.repo, config, google) });
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

describe('one-use browser-bound OAuth', () => {
  it('uses official auth URL generation, exact redirect, offline least privilege and S256 PKCE', async () => {
    const { oauth, google } = service();
    const started = await oauth.begin('oauth-owner');
    const url = new URL(started.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.events.owned');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toContain('consent');
    const stored = await database.pg.query('SELECT * FROM calendar_oauth_state');
    expect(JSON.stringify(stored.rows)).not.toContain(stateOf(started.url));
    expect(JSON.stringify(stored.rows)).not.toContain(started.browser);
    await oauth.complete('oauth-owner', started.browser, { state: stateOf(started.url), code: 'fixture-code' });
    expect(createHash('sha256').update(google.exchanges[0].verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    const connection = await database.repo.connection('oauth-owner');
    expect(connection.credentials).not.toContain('fixture-access');
    expect(JSON.parse(decrypt(connection.credentials!, config.encryptionKey, `credentials:oauth-owner:${connection.epoch}`))).toMatchObject({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
    await expect(oauth.complete('oauth-owner', started.browser, { state: stateOf(started.url), code: 'replay' })).rejects.toThrow();
    expect(google.exchanges).toHaveLength(1);
  });
  it('rejects wrong browser, owner, malformed state, expiration and denied consent without linking', async () => {
    const { oauth, google } = service();
    const start = await oauth.begin('bound-owner');
    for (const [owner, browser, state] of [['bound-owner', 'wrong', stateOf(start.url)], ['other-owner', start.browser, stateOf(start.url)], ['bound-owner', start.browser, 'malicious']]) {
      await expect(oauth.complete(owner, browser, { state, code: 'fixture-code' })).rejects.toThrow();
    }
    expect(google.exchanges).toHaveLength(0);
    await database.db.execute(sql`UPDATE calendar_oauth_state SET expires_at = now() - interval '1 second' WHERE owner_id = 'bound-owner'`);
    await expect(oauth.complete('bound-owner', start.browser, { state: stateOf(start.url), code: 'fixture-code' })).rejects.toThrow();
    const denied = await oauth.begin('denied-owner');
    await expect(oauth.complete('denied-owner', denied.browser, { state: stateOf(denied.url), error: 'access_denied' })).rejects.toThrow();
    await expect(oauth.complete('denied-owner', denied.browser, { state: stateOf(denied.url), code: 'fixture-code' })).rejects.toThrow();
    expect((await database.repo.connection('denied-owner')).credentials).toBeNull();
    expect(google.exchanges).toHaveLength(0);
  });
  it.each([undefined, 'https://www.googleapis.com/auth/calendar.readonly'])('does not trust callback scopes or link a token missing the requested scope (%s)', async (scope) => {
    const { oauth, google } = service(); google.tokens.scope = scope;
    const owner = `scope-${scope ? 'wrong' : 'missing'}`;
    const start = await oauth.begin(owner);
    await expect(oauth.complete(owner, start.browser, { state: stateOf(start.url), code: 'fixture-code' })).rejects.toThrow();
    expect((await database.repo.connection(owner)).credentials).toBeNull();
  });
  it('requires an offline refresh token, consumes concurrent callbacks atomically, and fences disconnect', async () => {
    const { oauth, google } = service();
    google.tokens.refreshToken = undefined;
    const start = await oauth.begin('offline-owner');
    await expect(oauth.complete('offline-owner', start.browser, { state: stateOf(start.url), code: 'code' })).rejects.toThrow();
    google.tokens.refreshToken = 'fixture-refresh';
    const race = await oauth.begin('race-owner');
    const entered = deferred(); const release = deferred();
    google.beforeExchange = async () => { entered.resolve(); await release.promise; };
    const pending = oauth.complete('race-owner', race.browser, { state: stateOf(race.url), code: 'code' }).catch(() => 'rejected');
    await entered.promise;
    await expect(oauth.complete('race-owner', race.browser, { state: stateOf(race.url), code: 'code' })).rejects.toThrow();
    await database.repo.disconnect('race-owner', false);
    release.resolve();
    expect(await pending).toBe('rejected');
    expect((await database.repo.connection('race-owner')).credentials).toBeNull();
  });
});