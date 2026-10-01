import { parseShoot, shootInputSchema, type CalendarView, type Shoot } from '../../lib/calendar';
import { HttpError } from '../errors';
import type { CalendarConfig } from './config';
import { readCredentials } from './credentials';
import type { GoogleTransport } from './google';
import type { CalendarRepository } from './repository';
import { synchronize } from './sync';

/** An explicit allowlist, not object spreading database rows into private/public JSON. */
export function shootView(shoot: Shoot): Shoot {
	return { id: shoot.id, collaborationId: shoot.collaborationId, title: shoot.title, startsAt: shoot.startsAt, endsAt: shoot.endsAt,
		timeZone: shoot.timeZone, location: shoot.location, reminderMinutes: shoot.reminderMinutes,
		revision: shoot.revision, cancelled: shoot.cancelled, status: shoot.status, error: shoot.error };
}
export function validatedShoot(input: unknown, collaborations: readonly { id: string; title: string }[]) {
	const parsed = shootInputSchema.parse(input);
	if (!collaborations.some((item) => item.id === parsed.collaborationId)) throw new HttpError(422, 'Choose an existing collaboration');
	return parseShoot(parsed, collaborations);
}
export class CalendarService {
	constructor(private readonly repo: CalendarRepository, private readonly config: CalendarConfig | null, private readonly google: GoogleTransport | null) {}
	async view(owner: string): Promise<CalendarView> {
		const connection = await this.repo.connection(owner);
		// Stored credentials still need a disconnect action when owner setup is missing.
		const connected = !!connection.credentials;
		const values = await this.repo.list(owner);
		return { configured: !!this.config, connected, demo: false, reconnectRequired: connection.reconnectRequired,
			shoots: values.map((value) => {
				const shoot = shootView(value.shoot);
				if (shoot.status === 'synced' && (!this.config || !connected || value.syncedEpoch !== connection.epoch)) { shoot.status = 'pending'; shoot.error = null; }
				if (connection.reconnectRequired && shoot.status !== 'cancelled') { shoot.status = 'error'; shoot.error = 'Saved in studio. Reconnect Google Calendar, then retry sync.'; }
				return shoot;
			}).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
	}
	private async sync(owner: string, id: string): Promise<CalendarView> {
		if (this.config && this.google) await synchronize(this.repo, this.config, this.google, owner, id);
		return this.view(owner);
	}
	async save(owner: string, input: unknown, expected: number, collaborations: readonly { id: string; title: string }[]): Promise<CalendarView> {
		const shoot = validatedShoot(input, collaborations);
		await this.repo.save(owner, shoot, expected);
		return this.sync(owner, shoot.id);
	}
	async cancel(owner: string, id: string, expected: number): Promise<CalendarView> {
		await this.repo.cancel(owner, id, expected);
		return this.sync(owner, id);
	}
	async retry(owner: string, id: string): Promise<CalendarView> {
		if (!this.config || !this.google) throw new HttpError(503, 'Google Calendar setup is required. Your saved shoots are safe.');
		if (!(await this.repo.connection(owner)).credentials) throw new HttpError(409, 'Connect Google Calendar before retrying.');
		if (!await this.repo.get(owner, id)) throw new HttpError(404, 'Shoot not found');
		return this.sync(owner, id);
	}
	async disconnect(owner: string): Promise<CalendarView & { notice: string }> {
		const result = await this.repo.disconnect(owner, false);
		let revoked = !result?.previous.credentials;
		try {
			if (result?.previous.credentials && this.config && this.google) {
				const tokens = readCredentials(result.previous.credentials, this.config, owner, result.previous.epoch);
				await this.google.revoke(tokens.refreshToken); revoked = true;
			}
		} catch { /* Local credentials stay removed even if Google is offline. No upstream details escape. */ }
		finally { if (result) await this.repo.endDisconnect(owner, result.epoch); }
		return { ...await this.view(owner), notice: revoked
			? 'Disconnected. Existing Google events were not deleted.'
			: 'Disconnected locally. Google revocation could not be confirmed; remove this app in your Google Account permissions. Existing events were not deleted.' };
	}
}