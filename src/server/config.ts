import { HttpError } from './errors';

export interface HostedConfig { databaseUrl: string; secret: string; baseUrl: string; adminId: string }

/** Never infer demo from an invalid/failed database connection. */
export function isDemo(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL?.trim();
}

export function getRuntimeConfig(): HostedConfig | null {
  if (isDemo()) return null;
  const { DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, ADMIN_USER_ID } = process.env;
  if (!DATABASE_URL || !BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32 || !BETTER_AUTH_URL || !ADMIN_USER_ID?.trim()) {
    throw new HttpError(503, 'Server configuration incomplete');
  }
  try {
    const database = new URL(DATABASE_URL);
    const base = new URL(BETTER_AUTH_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)
      || !['http:', 'https:'].includes(base.protocol) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash
      || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
      || ADMIN_USER_ID.length > 128) throw new Error('Invalid configuration');
    return { databaseUrl: DATABASE_URL, secret: BETTER_AUTH_SECRET, baseUrl: base.origin, adminId: ADMIN_USER_ID };
  } catch { throw new HttpError(503, 'Server configuration incomplete'); }
}

export function assertLocalDemo(request: Request): void {
  if (isDemo() && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) {
    throw new HttpError(503, 'Demo is available on localhost only');
  }
}