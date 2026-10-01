import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import type { StudioDatabase } from './database';
import { getDatabase } from './database';
import { assertLocalDemo, getRuntimeConfig, type HostedConfig } from './config';
import { HttpError } from './errors';
import * as schema from './schema';

export const phonePattern = /^\+[1-9]\d{7,14}$/;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export function normalizePhoneUsername(value: string): string {
  return /^[1-9]\d{7,14}$/.test(value) ? `+${value}` : value;
}
export function createAuth(config: HostedConfig, db: StudioDatabase) {
  return betterAuth({
    appName: 'Hey Priya Studio', baseURL: config.baseUrl, secret: config.secret,
    database: drizzleAdapter(db, { provider: 'pg', schema, transaction: false }),
    trustedOrigins: [config.baseUrl],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH, maxPasswordLength: MAX_PASSWORD_LENGTH },
    plugins: [username({
      minUsernameLength: 8, maxUsernameLength: 16, immutableUsername: true,
      // Validate the canonical value explicitly: this plugin version validates raw sign-in input.
      usernameValidator: (value) => phonePattern.test(normalizePhoneUsername(value)), usernameNormalization: normalizePhoneUsername,
      displayUsernameValidator: (value) => phonePattern.test(value),
    })],
    disabledPaths: [
      '/sign-up/email', '/sign-in/email', '/update-user', '/change-email', '/change-password',
      '/is-username-available', '/request-password-reset', '/reset-password', '/delete-user',
    ],
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60, cookieCache: { enabled: false } },
    // The route wrapper has an atomic, database-backed limit (no spoofable IP dependency).
    rateLimit: { enabled: false },
    advanced: { useSecureCookies: config.baseUrl.startsWith('https://') },
    databaseHooks: {
      user: { create: { before: async () => false }, update: { before: async (data) => {
        if ('username' in data || 'displayUsername' in data) return false;
      } } },
      session: { create: { before: async (session) => session.userId === config.adminId ? { data: session } : false } },
    },
    logger: { disabled: true }, telemetry: { enabled: false },
  });
}

let cached: { key: string; instance: ReturnType<typeof createAuth> } | undefined;
/** Evaluated at request time, never during Next's module collection/build. */
export function getAuth() {
  const config = getRuntimeConfig();
  if (!config) throw new HttpError(503, 'Authentication is unavailable in local demo mode');
  const key = JSON.stringify(config);
  if (!cached || cached.key !== key) cached = { key, instance: createAuth(config, getDatabase()) };
  return cached.instance;
}

export function assertAdminId(session: { user: { id: string } } | null, adminId: string): string {
  if (!adminId) throw new HttpError(503, 'Server configuration incomplete');
  if (!session) throw new HttpError(401, 'Sign in required');
  if (session.user.id !== adminId) throw new HttpError(403, 'Administrator access required');
  return session.user.id;
}

export async function requireAdmin(request: Request): Promise<string> {
  const config = getRuntimeConfig();
  if (!config) { assertLocalDemo(request); return 'local-demo-admin'; }
  const session = await getAuth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  return assertAdminId(session, config.adminId);
}