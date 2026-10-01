import { encryptionKey } from './crypto';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export interface CalendarConfig { clientId: string; clientSecret: string; encryptionKey: string; redirectUri: string }
/** Missing or invalid Google setup disables sync, not durable studio planning. Never echo values. */
export function calendarConfiguration(origin: string | null, env: Readonly<Record<string, string | undefined>> = process.env): CalendarConfig | null {
	if (!origin) return null; // The local demo must never become a real OAuth client.
	const { GOOGLE_CALENDAR_CLIENT_ID: clientId, GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret, GOOGLE_CALENDAR_ENCRYPTION_KEY: key } = env;
	if (!clientId?.trim() || !clientSecret?.trim() || !key) return null;
	try {
		encryptionKey(key);
		const base = new URL(origin);
		if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) return null;
		return { clientId, clientSecret, encryptionKey: key, redirectUri: `${origin}/api/calendar/callback` };
	} catch { return null; }
}