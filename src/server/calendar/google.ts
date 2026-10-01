import { OAuth2Client, type Credentials } from 'google-auth-library';
import { z } from 'zod';
import type { CalendarConfig } from './config';

export interface GoogleTokens { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string }
export interface RemoteEvent { id: string; etag?: string; status?: string; attendees?: unknown[]; extendedProperties?: { private?: Record<string, string> } }
export interface EventRequest { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; id: string; accessToken: string; body?: object; etag?: string }
export interface GoogleTransport {
  exchange(code: string, verifier: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  revoke(token: string): Promise<void>;
  event(request: EventRequest): Promise<{ status: number; event?: RemoteEvent }>;
}
export class GoogleFailure extends Error {
  constructor(readonly revoked = false) { super('Google Calendar is unavailable'); }
}
const remoteEventSchema = z.object({
  id: z.string(), etag: z.string().optional(), status: z.string().optional(), attendees: z.array(z.unknown()).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
function tokens(credentials: Credentials): GoogleTokens {
  if (!credentials.access_token || !credentials.expiry_date || !Number.isFinite(credentials.expiry_date)) throw new GoogleFailure();
  return { accessToken: credentials.access_token, refreshToken: credentials.refresh_token ?? undefined, expiresAt: credentials.expiry_date, scope: credentials.scope };
}
function failure(error: unknown): GoogleFailure {
  // Only inspect the error code. Never retain/serialize the upstream exception (it can hold tokens).
  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  return new GoogleFailure(data?.error === 'invalid_grant');
}
export class GoogleApi implements GoogleTransport {
  constructor(private readonly config: CalendarConfig, private readonly fetcher: typeof fetch = fetch) {}
  private client(): OAuth2Client {
    return new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.clientSecret, redirectUri: this.config.redirectUri,
      transporterOptions: { fetchImplementation: this.fetcher, timeout: 10_000, signal: AbortSignal.timeout(10_000), retryConfig: { retry: 0 }, redirect: 'error' } });
  }
  async exchange(code: string, verifier: string): Promise<GoogleTokens> {
    try { return tokens((await this.client().getToken({ code, codeVerifier: verifier, redirect_uri: this.config.redirectUri })).tokens); }
    catch (error) { throw failure(error); }
  }
  async refresh(refreshToken: string): Promise<GoogleTokens> {
    try {
      const client = this.client(); client.setCredentials({ refresh_token: refreshToken });
      return tokens((await client.refreshAccessToken()).credentials);
    } catch (error) { throw failure(error); }
  }
  async revoke(token: string): Promise<void> {
    try { await this.client().revokeToken(token); } catch (error) { throw failure(error); }
  }
  async event(request: EventRequest): Promise<{ status: number; event?: RemoteEvent }> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events' + (request.method === 'POST' ? '' : `/${encodeURIComponent(request.id)}`));
    if (request.method !== 'GET') url.searchParams.set('sendUpdates', 'none');
    const headers = new Headers({ Authorization: `Bearer ${request.accessToken}`, 'Content-Type': 'application/json' });
    if (request.etag) headers.set('If-Match', request.etag);
    try {
      const response = await this.fetcher(url, { method: request.method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
        ...(request.body ? { body: JSON.stringify(request.method === 'POST' ? { ...request.body, id: request.id } : request.body) } : {}) });
      if (!response.ok || response.status === 204) return { status: response.status };
      return { status: response.status, event: remoteEventSchema.parse(await response.json()) };
    } catch { throw new GoogleFailure(); }
  }
}