import { z } from 'zod';

export const CALENDAR_TIMEZONE = 'Asia/Kolkata' as const;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
export const shootInputSchema = z.object({
	id: identifier, collaborationId: identifier, title: z.string().trim().max(200).default(''),
	startsAt: instant, endsAt: instant, timeZone: z.literal(CALENDAR_TIMEZONE).default(CALENDAR_TIMEZONE),
	location: z.string().trim().max(500).default(''),
	reminderMinutes: z.array(z.number().int().min(0).max(40320)).max(5).default([1440, 60])
		.refine((values) => new Set(values).size === values.length, 'Reminders must be unique'),
}).strict().refine((value) => value.startsAt < value.endsAt, 'End must be after start');
export type ShootInput = z.infer<typeof shootInputSchema>;
export interface Shoot extends ShootInput {
	revision: number; cancelled: boolean; status: 'pending' | 'synced' | 'error' | 'cancelled'; error: string | null;
}
export interface CalendarView { configured: boolean; connected: boolean; demo: boolean; reconnectRequired: boolean; shoots: Shoot[] }
export const calendarActionSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('save'), expectedRevision: z.number().int().min(0), shoot: shootInputSchema }).strict(),
	z.object({ action: z.literal('cancel'), id: identifier, expectedRevision: z.number().int().min(1) }).strict(),
	z.object({ action: z.literal('retry'), id: identifier }).strict(),
	z.object({ action: z.literal('disconnect') }).strict(),
]);
export type CalendarAction = z.input<typeof calendarActionSchema>;

export function parseShoot(input: unknown, collaborations: readonly { id: string; title: string }[]): ShootInput {
	const shoot = shootInputSchema.parse(input);
	const collaboration = collaborations.find((item) => item.id === shoot.collaborationId);
	if (!collaboration) throw new Error('Choose an existing collaboration');
	return { ...shoot, title: shoot.title || collaboration.title };
}
export function indiaDateTime(date: string, time: string): string {
	return instant.parse(`${date}T${time}:00+05:30`);
}
export function localShootTime(value: string): { date: string; time: string } {
	const india = new Date(new Date(instant.parse(value)).getTime() + 330 * 60_000).toISOString();
	return { date: india.slice(0, 10), time: india.slice(11, 16) };
}
/** Hex is a subset of Google's base32hex alphabet. Generation changes only for tombstoned events. */
export function eventId(namespace: string, id: string, generation: number): string {
	return 'hp' + Array.from(new TextEncoder().encode(`${namespace}:${id}:${generation}`), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function googleEvent(shoot: Shoot, namespace: string) {
	return {
		summary: shoot.title, location: shoot.location, visibility: 'private',
		start: { dateTime: shoot.startsAt, timeZone: shoot.timeZone }, end: { dateTime: shoot.endsAt, timeZone: shoot.timeZone },
		reminders: { useDefault: false, overrides: shoot.reminderMinutes.map((minutes) => ({ method: 'popup', minutes })) },
		extendedProperties: { private: { app: 'hey-priya-studio', owner: namespace, schedule: shoot.id, revision: String(shoot.revision) } },
	};
}
export function upcomingShoots(shoots: readonly Shoot[], now: string, limit = 3): Shoot[] {
	return shoots.filter((shoot) => !shoot.cancelled && Date.parse(shoot.endsAt) > Date.parse(now))
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, limit);
}