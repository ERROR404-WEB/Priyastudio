import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAuth } from '../auth';
import { bootstrapAdmin } from '../bootstrap';
import { PostgresAggregateStore } from '../postgres-store';
import { mutateStore } from '../persistence';
import { publicPortfolio } from '../../lib/domain';
import * as schema from '../schema';
import { createCalendarHandlers } from './handlers';
import { calendarDatabase, config, FakeGoogle } from './test-helpers';
import { GET, POST } from '../../app/api/calendar/route';
import { POST as connect } from '../../app/api/calendar/connect/route';
import { GET as callback } from '../../app/api/calendar/callback/route';

const origin = 'http://localhost:3000';
const request = (path = '/api/calendar', body?: unknown, cookie = '') => new Request(origin + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const input = { id: 'route-shoot', collaborationId: 'work', startsAt: '2026-10-03T09:00:00+05:30', endsAt: '2026-10-03T10:00:00+05:30', location: 'Never public' };
let database: Awaited<ReturnType<typeof calendarDatabase>>;
let handlers: ReturnType<typeof createCalendarHandlers>;
let adminCookie: string; let otherCookie: string;
let google: FakeGoogle;
let hosted: { databaseUrl: string; baseUrl: string; adminId: string; secret: string };
let auth: ReturnType<typeof createAuth>;
beforeAll(async () => {
  database = await calendarDatabase();
  const adminId = await bootstrapAdmin(database.db, { ADMIN_PHONE: '+919876543210', ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'fixture-password-not-a-secret' });
  hosted = { databaseUrl: 'injected-db', baseUrl: origin, adminId, secret: 'fixture-secret-with-more-than-32-characters' };
  auth = createAuth(hosted, database.db);
  const login = await auth.handler(request('/api/auth/sign-in/username', { username: '+919876543210', password: 'fixture-password-not-a-secret' }));
  adminCookie = login.headers.get('set-cookie')!.split(';')[0];
  const [account] = await database.db.select().from(schema.account).where(eq(schema.account.userId, adminId));
  await database.db.insert(schema.user).values({ id: 'other-admin', name: 'Other', email: 'other@example.test', username: '+919876543211', displayUsername: '+919876543211' });
  await database.db.insert(schema.account).values({ id: 'other-account', accountId: 'other-admin', providerId: 'credential', userId: 'other-admin', password: account.password });
  const otherAuth = createAuth({ ...hosted, adminId: 'other-admin' }, database.db);
  const otherLogin = await otherAuth.handler(request('/api/auth/sign-in/username', { username: '+919876543211', password: 'fixture-password-not-a-secret' }));
  otherCookie = otherLogin.headers.get('set-cookie')!.split(';')[0];
  const aggregate = new PostgresAggregateStore(database.db);
  await mutateStore(aggregate, { type: 'brand.create', data: { id: 'brand', name: 'Brand', contact: '', email: '', category: 'Lifestyle', notes: '' } }, adminId);
  await mutateStore(aggregate, { type: 'collaboration.create', data: { id: 'work', brandId: 'brand', title: 'Linked collaboration', category: 'Lifestyle', stage: 'yet_to_visit', dueDate: '', image: '', reelUrl: '', description: '' } }, adminId);
  google = new FakeGoogle();
  handlers = createCalendarHandlers({ hosted, db: database.db, auth, calendar: config, google });
}, 30_000);
afterAll(async () => { await database.pg.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('owner-only calendar HTTP boundary with real sessions', () => {
  it('denies missing/non-owner sessions and cross-origin writes including connect', async () => {
    expect((await handlers.GET(request())).status).toBe(401);
    expect((await handlers.GET(request('/api/calendar', undefined, otherCookie))).status).toBe(403);
    for (const method of [handlers.POST, handlers.connect]) {
      const foreign = new Request(origin + '/api/calendar', { method: 'POST', headers: { cookie: adminCookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
      expect((await method(foreign)).status).toBe(403);
      expect((await method(request('/api/calendar', {}, otherCookie))).status).toBe(403);
    }
  });
  it('offers durable planning without setup and never reports a Google sync', async () => {
    const unconfigured = createCalendarHandlers({ hosted, db: database.db, auth, calendar: null });
    expect((await unconfigured.connect(request('/api/calendar/connect', {}, adminCookie))).status).toBe(503);
    const response = await unconfigured.POST(request('/api/calendar', { action: 'save', expectedRevision: 0, shoot: input }, adminCookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ configured: false, connected: false, demo: false, shoots: [{ title: 'Linked collaboration', status: 'pending' }] });
    expect((await unconfigured.POST(request('/api/calendar', { action: 'retry', id: input.id }, adminCookie))).status).toBe(503);
    expect((await unconfigured.POST(request('/api/calendar', { action: 'save', expectedRevision: 1, shoot: { ...input, collaborationId: 'unknown' } }, adminCookie))).status).toBe(422);
    expect((await unconfigured.POST(request('/api/calendar', { action: 'save', expectedRevision: 1, shoot: { ...input, refreshToken: 'client-token' } }, adminCookie))).status).toBe(400);
  });
  it('binds connect/callback cookies, cleans callback query, and excludes calendar data from aggregate/public views', async () => {
    const start = await handlers.connect(request('/api/calendar/connect', {}, adminCookie));
    expect(start.status).toBe(200);
    const browserCookie = start.headers.get('set-cookie')!;
    expect(browserCookie).toContain('HttpOnly'); expect(browserCookie).toContain('SameSite=Lax'); expect(browserCookie).toContain('Max-Age=600');
    const { url } = await start.json(); const state = new URL(url).searchParams.get('state')!;
    const result = await handlers.callback(request(`/api/calendar/callback?code=fixture-code&state=${state}`, undefined, `${adminCookie}; ${browserCookie.split(';')[0]}`));
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(origin + '/studio/calendar?connection=connected');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    const synced = await handlers.POST(request('/api/calendar', { action: 'retry', id: input.id }, adminCookie));
    expect((await synced.json()).shoots[0].status).toBe('synced');
    const view = await (await handlers.GET(request('/api/calendar', undefined, adminCookie))).json();
    expect(view.connected).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/fixture-access|fixture-refresh|credentials|verifier|stateHash|namespace/);
    const aggregate = await new PostgresAggregateStore(database.db).load();
    expect(JSON.stringify(aggregate)).not.toMatch(/Never public|fixture-access|fixture-refresh|route-shoot/);
    expect(JSON.stringify(publicPortfolio(aggregate))).not.toMatch(/Never public|fixture-access|fixture-refresh|route-shoot/);
    const replay = await handlers.callback(request(`/api/calendar/callback?code=fixture-code&state=${state}`, undefined, `${adminCookie}; ${browserCookie.split(';')[0]}`));
    expect(replay.headers.get('location')).toBe(origin + '/studio/calendar?connection=failed');
  });
  it('cleans an unauthenticated callback and a malicious query without linking', async () => {
    const anonymous = await handlers.callback(request('/api/calendar/callback?code=secret-code&state=malicious'));
    expect(anonymous.headers.get('location')).toBe(origin + '/login');
    const malicious = await handlers.callback(request('/api/calendar/callback?state=x&state=y&code=secret-code', undefined, adminCookie));
    expect(malicious.headers.get('location')).toBe(origin + '/studio/calendar?connection=failed');
    expect(await malicious.text()).not.toContain('secret-code');
  });
  it('rejects oversized JSON and enforces the shared database write rate limit', async () => {
    const huge = request('/api/calendar', { action: 'save', extra: 'x'.repeat(20_000) }, adminCookie);
    expect((await handlers.POST(huge)).status).toBe(413);
    await database.db.insert(schema.rateBuckets).values({ key: `calendar:write:${hosted.adminId}`, hits: 120, resetAt: new Date(Date.now() + 60_000) })
      .onConflictDoUpdate({ target: schema.rateBuckets.key, set: { hits: 120, resetAt: new Date(Date.now() + 60_000) } });
    const limited = await handlers.POST(request('/api/calendar', { action: 'retry', id: input.id }, adminCookie));
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60');
  });
});

describe('actual Next route demo and production setup gates', () => {
  it('persists synthetic planning but can never connect real Google even if OAuth variables exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calendar-route-demo-'));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'test-client'); vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', 'test-secret'); vi.stubEnv('GOOGLE_CALENDAR_ENCRYPTION_KEY', config.encryptionKey);
    try {
      expect((await (await GET(request())).json())).toMatchObject({ demo: true, configured: false, connected: false });
      expect((await connect(request('/api/calendar/connect', {}))).status).toBe(403);
      const saved = await POST(request('/api/calendar', { action: 'save', expectedRevision: 0, shoot: { ...input, collaborationId: 'demo-work-1' } }));
      expect((await saved.json()).shoots[0].status).toBe('pending');
      expect((await (await GET(request())).json()).shoots).toHaveLength(1);
      expect((await POST(request('/api/calendar', { action: 'retry', id: input.id }))).status).toBe(403);
      expect((await (await POST(request('/api/calendar', { action: 'cancel', id: input.id, expectedRevision: 1 }))).json()).shoots[0].status).toBe('cancelled');
      expect((await callback(request('/api/calendar/callback?code=never-exchange&state=bad'))).headers.get('location')).toContain('/studio/calendar?connection=failed');
      expect((await GET(new Request('https://remote.example/api/calendar'))).status).toBe(503);
      vi.stubEnv('NODE_ENV', 'production');
      expect((await GET(request())).status).toBe(503);
      expect((await POST(request('/api/calendar', { action: 'disconnect' }))).status).toBe(503);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});