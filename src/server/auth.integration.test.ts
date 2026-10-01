import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth';
import { bootstrapAdmin } from './bootstrap';
import { consumeDatabaseLimit } from './rate-limit';
import * as schema from './schema';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const origin = 'http://localhost:3000';
beforeAll(async () => { await pg.exec(await readFile(new URL('../../drizzle/0000_studio.sql', import.meta.url), 'utf8')); }, 30_000);
afterAll(async () => { await pg.close(); });

describe('real PostgreSQL authentication and limits', () => {
  it('bootstraps once, hashes credentials, and signs in through the actual username plugin and adapter', async () => {
    const input = { ADMIN_PHONE: '+919876543210', ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'fixture-password-not-a-secret' };
    const adminId = await bootstrapAdmin(db, input);
    await expect(bootstrapAdmin(db, input)).rejects.toThrow();
    expect((await db.select().from(schema.user))).toHaveLength(1);
    expect((await db.select().from(schema.account))[0].password).not.toBe(input.ADMIN_PASSWORD);
    const auth = createAuth({ baseUrl: origin, databaseUrl: 'unused-by-injected-database', secret: 'test-secret-with-more-than-thirty-two-characters', adminId }, db);
    const request = (path: string, body: object) => new Request(origin + '/api/auth/' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const response = await auth.handler(request('sign-in/username', { username: input.ADMIN_PHONE, password: input.ADMIN_PASSWORD }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(';')[0] }) });
    expect(session?.user.id).toBe(adminId);
    // The browser normalizes phone input to digits; the server canonicalizes back to E.164.
    expect((await auth.handler(request('sign-in/username', { username: '919876543210', password: input.ADMIN_PASSWORD }))).status).toBe(200);
    expect((await auth.handler(request('sign-up/email', { name: 'Attacker', email: 'other@example.test', password: input.ADMIN_PASSWORD }))).status).toBe(404);
    expect((await auth.handler(request('update-user', { username: '+911111111111' }))).status).toBe(404);
    expect((await auth.handler(request('is-username-available', { username: input.ADMIN_PHONE }))).status).toBe(404);
    const denied = await auth.handler(request('sign-in/username', { username: input.ADMIN_PHONE, password: 'wrong-password' }));
    expect(denied.status).toBe(401);
    const otherAdmin = createAuth({ baseUrl: origin, databaseUrl: 'unused', secret: 'test-secret-with-more-than-thirty-two-characters', adminId: 'someone-else' }, db);
    expect((await otherAdmin.handler(request('sign-in/username', { username: input.ADMIN_PHONE, password: input.ADMIN_PASSWORD }))).ok).toBe(false);
  }, 30_000);

  it('accepts an 8-character admin password end to end and rejects anything shorter', async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(await readFile(new URL('../../drizzle/0000_studio.sql', import.meta.url), 'utf8'));
      const freshDb = drizzle(fresh, { schema });
      const base = { ADMIN_PHONE: '+919876543210', ADMIN_EMAIL: 'owner@example.test' };
      await expect(bootstrapAdmin(freshDb, { ...base, ADMIN_PASSWORD: 'seven77' })).rejects.toThrow();
      const adminId = await bootstrapAdmin(freshDb, { ...base, ADMIN_PASSWORD: 'eight888' });
      const auth = createAuth({ baseUrl: origin, databaseUrl: 'unused', secret: 'test-secret-with-more-than-thirty-two-characters', adminId }, freshDb);
      const response = await auth.handler(new Request(origin + '/api/auth/sign-in/username', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: base.ADMIN_PHONE, password: 'eight888' }) }));
      expect(response.status).toBe(200);
    } finally { await fresh.close(); }
  }, 30_000);

  it('enforces an atomic shared rate limit across concurrent database callers', async () => {
    const result = await Promise.allSettled(Array.from({ length: 8 }, () => consumeDatabaseLimit(db, 'test-quota', 3, 60)));
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(3);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(5);
    await db.update(schema.rateBuckets).set({ resetAt: new Date(0) }).where(eq(schema.rateBuckets.key, 'test-quota'));
    await expect(consumeDatabaseLimit(db, 'test-quota', 3, 60)).resolves.toBeUndefined();
    expect((await db.select().from(schema.rateBuckets).where(eq(schema.rateBuckets.key, 'test-quota')))[0].hits).toBe(1);
  });
});