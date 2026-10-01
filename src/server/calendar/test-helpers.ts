import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema';
import { migrationStatements } from '../migrations';
import { GOOGLE_SCOPE, type CalendarConfig } from './config';
import { CalendarRepository } from './repository';
import { GoogleFailure, type EventRequest, type GoogleTokens, type GoogleTransport, type RemoteEvent } from './google';

export const config: CalendarConfig = { clientId: 'test-client', clientSecret: 'test-client-secret', encryptionKey: Buffer.alloc(32, 9).toString('base64'), redirectUri: 'http://localhost:3000/api/calendar/callback' };
export const validTokens = (): GoogleTokens => ({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600_000, scope: GOOGLE_SCOPE });
export async function calendarDatabase() {
  const pg = new PGlite();
  for (const file of ['0000_studio.sql', '0001_calendar.sql', '0002_calendar_validation.sql']) {
    for (const statement of migrationStatements(await readFile(new URL(`../../../drizzle/${file}`, import.meta.url), 'utf8'))) await pg.exec(statement);
  }
  const db = drizzle(pg, { schema });
  return { pg, db, repo: new CalendarRepository(db) };
}
/** Only the external Google boundary is substituted. Database, service, crypto and auth stay real. */
export class FakeGoogle implements GoogleTransport {
  events = new Map<string, RemoteEvent & Record<string, unknown>>();
  tokens = validTokens();
  requests: EventRequest[] = [];
  revocations: string[] = [];
  exchanges: { code: string; verifier: string }[] = [];
  refreshes = 0;
  fail = false;
  revoked = false;
  failDelete = false;
  loseCreateResponse = false;
  beforeEvent?: (request: EventRequest) => Promise<void>;
  beforeExchange?: () => Promise<void>;
  beforeRefresh?: () => Promise<void>;
  version = 0;
  async exchange(code: string, verifier: string) {
    this.exchanges.push({ code, verifier }); await this.beforeExchange?.();
    if (this.fail) throw new GoogleFailure(); return { ...this.tokens };
  }
  async refresh() {
    this.refreshes++; await this.beforeRefresh?.();
    if (this.revoked) throw new GoogleFailure(true);
    if (this.fail) throw new GoogleFailure();
    return { ...validTokens(), accessToken: 'refreshed-access' };
  }
  async revoke(token: string) { this.revocations.push(token); if (this.fail) throw new GoogleFailure(); }
  async event(request: EventRequest) {
    this.requests.push(request); await this.beforeEvent?.(request);
    if (this.fail || (this.failDelete && request.method === 'DELETE')) throw new GoogleFailure();
    if (this.revoked) return { status: 401 };
    const old = this.events.get(request.id);
    if (request.method === 'GET') return old ? { status: 200, event: { ...old } } : { status: 404 };
    if (request.method === 'POST' && old) return { status: 409 };
    if (request.method !== 'POST' && !old) return { status: 404 };
    if (request.method !== 'POST' && request.etag !== old?.etag) return { status: 412 };
    if (request.method !== 'POST' && old?.status === 'cancelled') return { status: 410 };
    if (request.method === 'DELETE') { this.events.set(request.id, { id: request.id, etag: `"${++this.version}"`, status: 'cancelled' }); return { status: 204 }; }
    const next = { ...request.body, id: request.id, etag: `"${++this.version}"` } as RemoteEvent & Record<string, unknown>;
    this.events.set(request.id, next);
    if (request.method === 'POST' && this.loseCreateResponse) { this.loseCreateResponse = false; throw new GoogleFailure(); }
    return { status: 200, event: { ...next } };
  }
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}