import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, encryptionKey } from './crypto';
import { calendarConfiguration } from './config';

const key = Buffer.alloc(32, 7).toString('base64');
describe('calendar secrets', () => {
  it('round trips real AES-256-GCM with randomized IVs, version and context binding', () => {
    const one = encrypt('private-token', key, 'owner:1');
    const two = encrypt('private-token', key, 'owner:1');
    expect(one).not.toBe(two);
    expect(one).toMatch(/^v1\./);
    expect(one).not.toContain('private-token');
    expect(decrypt(one, key, 'owner:1')).toBe('private-token');
    expect(() => decrypt(one, key, 'owner:2')).toThrow();
    expect(() => decrypt(one, Buffer.alloc(32, 8).toString('base64'), 'owner:1')).toThrow();
    const parts = one.split('.');
    for (const index of [1, 2, 3]) {
      const changed = [...parts];
      const bytes = Buffer.from(changed[index], 'base64url'); bytes[0] ^= 1; changed[index] = bytes.toString('base64url');
      expect(() => decrypt(changed.join('.'), key, 'owner:1')).toThrow();
    }
    expect(() => decrypt(one.replace('v1.', 'v2.'), key, 'owner:1')).toThrow();
  });
  it.each(['', 'not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64')])('rejects invalid key material without echoing it', (value) => {
    expect(() => encryptionKey(value)).toThrow('Calendar encryption key must be base64-encoded 32 bytes');
  });
  it('derives the exact redirect from the canonical auth origin and never configures demo', () => {
    const env = { GOOGLE_CALENDAR_CLIENT_ID: 'test-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'test-secret', GOOGLE_CALENDAR_ENCRYPTION_KEY: key };
    expect(calendarConfiguration(null, env)).toBeNull();
    expect(calendarConfiguration('https://studio.example', env)?.redirectUri).toBe('https://studio.example/api/calendar/callback');
    expect(calendarConfiguration('https://studio.example', { ...env, GOOGLE_CALENDAR_ENCRYPTION_KEY: 'invalid' })).toBeNull();
    expect(calendarConfiguration('https://studio.example', {})).toBeNull();
  });
});