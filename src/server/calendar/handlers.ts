import { join } from 'node:path';
import { z } from 'zod';
import { calendarActionSchema, type CalendarView } from '../../lib/calendar';
import { createDemoState } from '../../lib/seed';
import { assertAdminId, type createAuth } from '../auth';
import { assertLocalDemo, isDemo, type HostedConfig } from '../config';
import type { StudioDatabase } from '../database';
import { HttpError } from '../errors';
import { FileAggregateStore } from '../file-store';
import { assertSameOrigin, jsonEndpoint, privateHeaders, readJson } from '../http';
import { PostgresAggregateStore } from '../postgres-store';
import { consumeDatabaseLimit, rateLimit } from '../rate-limit';
import type { CalendarConfig } from './config';
import { DemoCalendarRepository } from './demo';
import { GoogleApi, type GoogleTransport } from './google';
import { CalendarOAuth } from './oauth';
import { CalendarRepository } from './repository';
import { CalendarService, shootView, validatedShoot } from './service';

interface Dependencies {
	hosted: HostedConfig | null; db?: StudioDatabase; auth?: ReturnType<typeof createAuth>;
	calendar: CalendarConfig | null; google?: GoogleTransport;
}
export function createCalendarHandlers(deps: Dependencies) {
	const { hosted } = deps;
	const repo = hosted && deps.db ? new CalendarRepository(deps.db) : null;
	const google = hosted && deps.calendar ? deps.google ?? new GoogleApi(deps.calendar) : null;
	const service = repo ? new CalendarService(repo, deps.calendar, google) : null;
	const demo = new DemoCalendarRepository(join(process.cwd(), '.data', 'calendar.json'));
	const cookieName = hosted?.baseUrl.startsWith('https:') ? '__Secure-hp-calendar-oauth' : 'hp-calendar-oauth';
	const cookie = (value: string, seconds: number) => `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=${seconds}${hosted?.baseUrl.startsWith('https:') ? '; Secure' : ''}`;
	async function owner(request: Request): Promise<string> {
		if (!hosted) {
			if (!isDemo()) throw new HttpError(503, 'Server configuration incomplete');
			assertLocalDemo(request); return 'local-demo-admin';
		}
		if (!deps.auth || !repo) throw new HttpError(503, 'Server configuration incomplete');
		const session = await deps.auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
		return assertAdminId(session, hosted.adminId);
	}
	async function limit(kind: string, actor: string, max: number) {
		const key = `calendar:${kind}:${actor}`;
		if (hosted && deps.db) await consumeDatabaseLimit(deps.db, key, max, 60);
		else await rateLimit(key, max);
	}
	const demoView = async (): Promise<CalendarView> => ({ configured: false, connected: false, demo: true, reconnectRequired: false, shoots: (await demo.list()).map(shootView) });
	function oauth(): CalendarOAuth {
		if (!hosted) throw new HttpError(403, 'Local demo cannot connect to Google. Use synthetic schedules only.');
		if (!repo || !deps.calendar || !google) throw new HttpError(503, 'Google Calendar owner setup is required. Your saved shoots are safe.');
		return new CalendarOAuth(repo, deps.calendar, google);
	}
	return {
		GET: (request: Request) => jsonEndpoint(async () => {
			const actor = await owner(request); await limit('read', actor, 240);
			return service ? service.view(actor) : demoView();
		}),
		POST: (request: Request) => jsonEndpoint(async () => {
			assertSameOrigin(request, hosted?.baseUrl);
			const actor = await owner(request); await limit('write', actor, 120);
			const action = calendarActionSchema.parse(await readJson(request, 16 * 1024));
			if (action.action === 'save') {
				const aggregate = hosted && deps.db ? new PostgresAggregateStore(deps.db) : new FileAggregateStore(join(process.cwd(), '.data', 'studio.json'), createDemoState);
				const { collaborations } = await aggregate.load();
				if (service) return service.save(actor, action.shoot, action.expectedRevision, collaborations);
				await demo.save(validatedShoot(action.shoot, collaborations), action.expectedRevision);
			} else if (action.action === 'cancel') {
				if (service) return service.cancel(actor, action.id, action.expectedRevision);
				await demo.cancel(action.id, action.expectedRevision);
			} else if (action.action === 'retry') {
				if (service) return service.retry(actor, action.id);
				throw new HttpError(403, 'Local demo does not sync to Google. Your sample shoot is saved.');
			} else if (action.action === 'disconnect' && service) return service.disconnect(actor);
			return demoView();
		}),
		connect: (request: Request) => jsonEndpoint(async () => {
			assertSameOrigin(request, hosted?.baseUrl);
			const actor = await owner(request); await limit('connect', actor, 10);
			z.object({}).strict().parse(await readJson(request, 1024));
			const { url, browser } = await oauth().begin(actor);
			return Response.json({ url }, { headers: { 'Set-Cookie': cookie(browser, 600) } });
		}),
		callback: async (request: Request): Promise<Response> => {
			// Google redirects via GET; one-use browser-bound state replaces Origin only on this endpoint.
			let destination = '/studio/calendar?connection=failed';
			try {
				const actor = await owner(request); await limit('callback', actor, 20);
				const flow = oauth();
				const url = new URL(request.url);
				if (url.origin + url.pathname !== deps.calendar!.redirectUri || request.url.length > 8192) throw new HttpError(400, 'Invalid callback');
				const query = url.searchParams;
				if (['state', 'code', 'error'].some((key) => query.getAll(key).length > 1)) throw new HttpError(400, 'Invalid callback');
				const cookies = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(cookieName + '='));
				const browser = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : '';
				await flow.complete(actor, browser, { state: query.get('state') ?? undefined, code: query.get('code') ?? undefined, error: query.get('error') ?? undefined });
				destination = '/studio/calendar?connection=connected';
			} catch (error) {
				if (error instanceof HttpError && error.status === 401) destination = '/login';
				// No callback code, state, upstream error, or token is reflected in the redirect/body.
			}
			return new Response(null, { status: 303, headers: { ...privateHeaders, Location: `${hosted?.baseUrl ?? ''}${destination}`, 'Set-Cookie': cookie('', 0) } });
		},
	};
}