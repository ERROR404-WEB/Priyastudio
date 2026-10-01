import { describe, expect, it } from 'vitest';
import { GoogleApi } from './google';
import { config } from './test-helpers';

describe('official Google auth and Calendar REST boundary', () => {
  it('exchanges PKCE and refreshes through the official library, without returning raw OAuth responses', async () => {
    const requests: { url: string; body: string }[] = [];
    const transport: typeof fetch = async (url, options) => {
      requests.push({ url: String(url), body: String(options?.body) });
      return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events.owned', token_type: 'Bearer' });
    };
    const api = new GoogleApi(config, transport);
    const result = await api.exchange('code', 'pkce-verifier');
    expect(result).toMatchObject({ accessToken: 'test-access', refreshToken: 'test-refresh' });
    expect(new URLSearchParams(requests[0].body).get('code_verifier')).toBe('pkce-verifier');
    expect(new URLSearchParams(requests[0].body).get('redirect_uri')).toBe(config.redirectUri);
    expect(requests[0].url).toBe('https://oauth2.googleapis.com/token');
    await api.refresh('old-refresh');
    expect(new URLSearchParams(requests[1].body).get('refresh_token')).toBe('old-refresh');
    expect(new URLSearchParams(requests[1].body).get('grant_type')).toBe('refresh_token');
  });
  it('bounds requests, uses bearer headers, ETags and no notifications, and never forwards error bodies', async () => {
    const requests: { url: URL; options: RequestInit }[] = [];
    const transport: typeof fetch = async (url, options) => {
      requests.push({ url: new URL(String(url)), options: options! });
      return Response.json({ error: { message: 'private-upstream-secret' } }, { status: 412 });
    };
    const api = new GoogleApi(config, transport);
    expect(await api.event({ method: 'PATCH', id: 'hp12345', accessToken: 'private-access', etag: '"etag"', body: { summary: 'Visit' } })).toEqual({ status: 412 });
    expect(requests[0].url.pathname).toBe('/calendar/v3/calendars/primary/events/hp12345');
    expect(requests[0].url.searchParams.get('sendUpdates')).toBe('none');
    const headers = new Headers(requests[0].options.headers);
    expect(headers.get('authorization')).toBe('Bearer private-access');
    expect(headers.get('if-match')).toBe('"etag"');
    expect(requests[0].options.signal).toBeInstanceOf(AbortSignal);
    expect(requests[0].options.redirect).toBe('error');
    expect(String(requests[0].url)).not.toContain('private-access');
  });
  it('sanitizes token failures and recognizes a revoked grant', async () => {
    const api = new GoogleApi(config, async () => Response.json({ error: 'invalid_grant', error_description: 'private-upstream-secret' }, { status: 400 }));
    await expect(api.refresh('private-refresh')).rejects.toMatchObject({ revoked: true, message: 'Google Calendar is unavailable' });
  });
});