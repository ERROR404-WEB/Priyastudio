import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameOrigin, jsonEndpoint, readJson } from './http';
import { getRuntimeConfig, isDemo } from './config';
import { assertAdminId } from './auth';
import { detectImage } from './media';
import { HttpError } from './errors';

afterEach(() => vi.unstubAllEnvs());
const request = (origin?: string, body = '{}') => new Request('http://localhost:3000/api/studio', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body,
});

describe('server trust boundaries', () => {
  it('never enables demo in production with missing secrets', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DATABASE_URL', '');
    expect(isDemo()).toBe(false);
    expect(() => getRuntimeConfig()).toThrow(HttpError);
  });
  it('can collect server modules without build-time secrets but refuses runtime authentication', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const name of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'ADMIN_USER_ID']) vi.stubEnv(name, '');
    vi.resetModules();
    const authModule = await import('./auth');
    expect(typeof authModule.getAuth).toBe('function');
    // Module re-evaluation succeeds in production, but its request-time entry point refuses access.
    expect(() => authModule.getAuth()).toThrowError(expect.objectContaining({ status: 503 }));
  });
  it('does not switch to demo when a configured database is missing the remaining auth settings', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'postgresql://example.invalid/database');
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('BETTER_AUTH_URL', '');
    vi.stubEnv('ADMIN_USER_ID', '');
    expect(isDemo()).toBe(false);
    expect(() => getRuntimeConfig()).toThrowError(expect.objectContaining({ status: 503 }));
  });
  it('allows demo only without a configured database outside production', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATABASE_URL', '');
    expect(isDemo()).toBe(true);
    vi.stubEnv('DATABASE_URL', 'postgresql://example.invalid/database');
    expect(isDemo()).toBe(false);
  });
  it('requires an exact request and configured origin, never wildcard or missing origins', () => {
    expect(() => assertSameOrigin(request('http://localhost:3000'), 'http://localhost:3000')).not.toThrow();
    for (const origin of [undefined, 'null', 'https://evil.test', 'http://localhost:3000.evil.test']) {
      expect(() => assertSameOrigin(request(origin), 'http://localhost:3000')).toThrow(HttpError);
    }
    expect(() => assertSameOrigin(request('http://localhost:3000'), 'https://studio.example')).toThrow(HttpError);
  });
  it('denies a valid session belonging to anyone except the allowlisted admin', () => {
    expect(() => assertAdminId({ user: { id: 'other' } }, 'owner')).toThrow(HttpError);
    expect(() => assertAdminId(null, 'owner')).toThrow(HttpError);
    expect(() => assertAdminId({ user: { id: 'owner' } }, '')).toThrow(HttpError);
    expect(assertAdminId({ user: { id: 'owner' } }, 'owner')).toBe('owner');
  });
  it('rejects malformed JSON and bounds actual streamed bytes without Content-Length', async () => {
    await expect(readJson(request('http://localhost:3000', '{'))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(request('http://localhost:3000', '"' + 'a'.repeat(50) + '"'), 16)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(new Request('http://localhost', { method: 'POST', body: '{}' }))).rejects.toMatchObject({ status: 415 });
  });
  it('returns safe JSON errors and share privacy headers, not exception details', async () => {
    const response = await jsonEndpoint(async () => { throw new Error('postgres://secret:password@private'); });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Service temporarily unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    const bad = await jsonEndpoint(async () => { throw new HttpError(403, 'Forbidden'); });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: 'Forbidden' });
  });
  it('checks raster signatures rather than trusting SVG, filenames, or declared MIME', () => {
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]))).toBe('image/jpeg');
    expect(() => detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toThrow(HttpError);
    expect(() => detectImage(Buffer.alloc(4 * 1024 * 1024 + 1))).toThrow(HttpError);
    expect(() => detectImage(Buffer.from('not a png'))).toThrow(HttpError);
  });
});