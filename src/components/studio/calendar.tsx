'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { errorMessage, requestJSON } from '@/lib/client';
import { indiaDateTime, localShootTime, parseShoot, upcomingShoots, type CalendarAction, type CalendarView, type Shoot, type ShootInput } from '@/lib/calendar';
import { Badge, ConfirmDialog, EmptyState, ErrorNotice, Field, PageHeading, useTask } from '@/components/ui/studio-primitives';
import type { Brand } from '@/lib/types';
import { BrandPicker, ensureBrand } from './forms';
import { useStudio } from './store';

type CollaborationChoice = { id: string; title: string };
type NewCollaboration = { id: string; brandId: string; brandName: string; category: string; title: string };
type CreateCollaboration = (input: NewCollaboration) => Promise<CollaborationChoice>;
const NEW_COLLABORATION = '__new__';
const control: CSSProperties = { minHeight: 44, minWidth: 44 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16 };
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const card: CSSProperties = { padding: 20, marginBottom: 20, minWidth: 0, overflowWrap: 'anywhere' };
const reminderChoices = [
	{ value: '1440,60', label: '1 day and 1 hour before' },
	{ value: '1440', label: '1 day before' },
	{ value: '60', label: '1 hour before' },
	{ value: '30', label: '30 minutes before' },
	{ value: '', label: 'No reminders' },
];
function reminderLabel(minutes: readonly number[]) {
	const key = [...minutes].sort((a, b) => b - a).join(',');
	return reminderChoices.find((choice) => choice.value === key)?.label
		?? minutes.map((value) => value === 0 ? 'At the start' : `${value} minutes before`).join(' and ');
}
function when(shoot: Shoot) {
	const date = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
	return `${date(shoot.startsAt)} – ${date(shoot.endsAt)} · Asia/Kolkata`;
}
function statusText(shoot: Shoot) {
	if (shoot.cancelled) return shoot.status === 'cancelled' ? 'Cancelled' : 'Google deletion pending';
	return shoot.status === 'synced' ? 'Google synced' : shoot.status === 'error' ? 'Saved in studio · Google sync needs attention' : 'Saved in studio · Google sync pending';
}

export function formatShootWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateStr = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(start);
  const startTimeStr = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(start);
  const endTimeStr = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(end);
  return `${dateStr}, ${startTimeStr} – ${endTimeStr}`;
}

/** Private-only: fetches the owner endpoint when data is not supplied by a parent. */
export function useCalendarData(enabled: boolean) {
	const [view, setView] = useState<CalendarView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const sequence = useRef(0);
	const accept = useCallback((value: CalendarView) => { sequence.current++; setView(value); setError(null); }, []);
	const reload = useCallback(async () => {
		const request = ++sequence.current;
		try { const result = await requestJSON<CalendarView>('/api/calendar'); if (request === sequence.current) { setView(result); setError(null); } }
		catch (error) { if (request === sequence.current) setError(errorMessage(error)); }
	}, []);
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController(); const request = ++sequence.current;
		void requestJSON<CalendarView>('/api/calendar', { signal: controller.signal }).then((result) => {
			if (!controller.signal.aborted && request === sequence.current) { setView(result); setError(null); }
		}).catch((error: unknown) => { if (!controller.signal.aborted && request === sequence.current) setError(errorMessage(error)); });
		const focus = () => { void reload(); };
		window.addEventListener('focus', focus);
		return () => { controller.abort(); window.removeEventListener('focus', focus); };
	}, [enabled, reload]);
	return { view, error, accept, reload };
}

export function ShootPlanner({ collaborations, editing, onSave, onClose, busy = false, brands = [], onCreateCollaboration }: {
	collaborations: readonly CollaborationChoice[]; editing?: Shoot | null;
	onSave: (shoot: ShootInput, expectedRevision: number) => Promise<void>; onClose: () => void; busy?: boolean;
	brands?: readonly Pick<Brand, 'id' | 'name' | 'category'>[]; onCreateCollaboration?: CreateCollaboration;
}) {
	const task = useTask();
	const [id] = useState(() => editing?.id ?? crypto.randomUUID());
	const [newIds] = useState(() => ({ collaboration: crypto.randomUUID(), brand: crypto.randomUUID() }));
	const canCreate = Boolean(onCreateCollaboration) && !editing;
	const [choice, setChoice] = useState(() => editing?.collaborationId ?? (canCreate && !collaborations.length ? NEW_COLLABORATION : ''));
	const [brandName, setBrandName] = useState('');
	const creating = canCreate && choice === NEW_COLLABORATION;
	const [today] = useState(() => localShootTime(new Date().toISOString()).date);
	const initialReminders = [...(editing?.reminderMinutes ?? [1440, 60])].sort((a, b) => b - a).join(',');
	const [reminderChoice, setReminderChoice] = useState(() => reminderChoices.some((choice) => choice.value === initialReminders) ? initialReminders : 'custom');
	const [locked, setLocked] = useState(false);
	const frozen = useRef<ShootInput | null>(null);
	const firstInput = useRef<HTMLSelectElement>(null);
	useEffect(() => { if (editing) firstInput.current?.focus(); }, [editing]);
	const start = editing ? localShootTime(editing.startsAt) : { date: today, time: '09:00' };
	const end = editing ? localShootTime(editing.endsAt) : { date: today, time: '10:00' };
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget); const text = (name: string) => String(data.get(name) ?? '').trim();
		void task.run(async () => {
			let shoot = frozen.current;
			if (!shoot) {
				const reminders = reminderChoice === 'custom' ? text('reminders') : reminderChoice;
				if (reminders && !/^\d+(\s*,\s*\d+)*$/.test(reminders)) throw new Error('Use comma-separated whole reminder minutes, for example 1440, 60.');
				let choices = collaborations; let collaborationId = text('collaborationId');
				if (creating && onCreateCollaboration) {
					const created = await onCreateCollaboration({ id: newIds.collaboration, brandId: newIds.brand, brandName, category: text('brandCategory'), title: text('newTitle') });
					choices = [...collaborations, created]; collaborationId = created.id;
				}
				try {
					shoot = parseShoot({ id, collaborationId, title: text('title'), location: text('location'),
						startsAt: indiaDateTime(text('startDate'), text('startTime')), endsAt: indiaDateTime(text('endDate'), text('endTime')),
						reminderMinutes: reminders ? reminders.split(',').map(Number) : [] }, choices);
				} catch { throw new Error('Choose a collaboration and valid dates, with the end after the start. Use up to five different reminder values between 0 and 40320 minutes.'); }
				frozen.current = shoot; setLocked(true);
			}
			await onSave(shoot, editing?.revision ?? 0);
		});
	}
	return <section className="studio-card" style={card} aria-labelledby="shoot-planner-heading">
		<h2 id="shoot-planner-heading">{editing ? 'Reschedule shoot' : 'Plan a shoot'}</h2>
		<p className="studio-muted">Times are in Asia/Kolkata (India, UTC+05:30). A shoot is separate from the collaboration’s posting deadline.</p>
		{!collaborations.length && !canCreate ? <EmptyState title="Add a collaboration first" description="Every shoot belongs to an existing collaboration." action={<Link style={control} className="studio-button" href="/studio/collaborations">Open collaborations</Link>} /> : <form onSubmit={submit} aria-label={editing ? 'Reschedule shoot' : 'Plan a shoot'}>
			<fieldset className="studio-fieldset" disabled={task.pending || busy || locked} style={grid}>
				<Field label="Collaboration"><select ref={firstInput} className="studio-input" style={control} name="collaborationId" required value={choice} onChange={(event) => setChoice(event.target.value)}><option value="" disabled>Choose a collaboration</option>{canCreate && <option value={NEW_COLLABORATION}>+ New collaboration (new or existing brand)</option>}{collaborations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
				{creating && <>
					<BrandPicker brands={brands} value={brandName} onChange={setBrandName} />
					<Field label="Collaboration title" hint="Added to your collaborations as “Yet to visit”."><input className="studio-input" style={control} name="newTitle" required maxLength={300} placeholder="October café reel" /></Field>
				</>}
				<Field label="Title (optional)" hint="Leave blank to use the collaboration title."><input className="studio-input" style={control} name="title" maxLength={200} defaultValue={editing?.title ?? ''} /></Field>
				<Field label="Start date"><input className="studio-input" style={control} type="date" name="startDate" required defaultValue={start.date} /></Field>
				<Field label="Start time"><input className="studio-input" style={control} type="time" name="startTime" required defaultValue={start.time} /></Field>
				<Field label="End date"><input className="studio-input" style={control} type="date" name="endDate" required defaultValue={end.date} /></Field>
				<Field label="End time"><input className="studio-input" style={control} type="time" name="endTime" required defaultValue={end.time} /></Field>
				<Field label="Location (optional)" hint="Private to your studio and your connected Google Calendar."><input className="studio-input" style={control} name="location" maxLength={500} defaultValue={editing?.location ?? ''} /></Field>
				<Field label="Remind me" hint="Reminders start working after this shoot is synced to Google Calendar."><select className="studio-input" style={control} value={reminderChoice} onChange={(event) => setReminderChoice(event.target.value)}>{reminderChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}<option value="custom">Custom reminders</option></select></Field>
				{reminderChoice === 'custom' && <Field label="Reminder minutes" hint="Advanced: enter up to five times, separated by commas. 1440 is one day; 60 is one hour."><input className="studio-input" style={control} name="reminders" maxLength={40} defaultValue={(editing?.reminderMinutes ?? [1440, 60]).join(', ')} /></Field>}
			</fieldset>
			<ErrorNotice message={task.error} />
			{locked && task.error && <p role="status">These details are kept for a safe retry with the same shoot ID. Reload the calendar before planning another copy if the response was lost.</p>}
			<div style={{ ...actions, marginTop: 16 }}>
				<button type="submit" style={control} className="studio-button" disabled={task.pending || busy}>{task.pending ? 'Saving shoot…' : locked ? 'Retry this save' : editing ? 'Save new time' : 'Save shoot'}</button>
				{editing && <button type="button" style={control} className="studio-button studio-button-secondary" onClick={onClose} disabled={task.pending}>Stop editing</button>}
			</div>
		</form>}
	</section>;
}

export function CalendarScreen({ view, collaborations, onAction, onConnect, busy = false, onReload, brands, onCreateCollaboration }: {
	view: CalendarView; collaborations: readonly CollaborationChoice[];
	onAction: (action: CalendarAction) => Promise<void>; onConnect: () => Promise<void>; busy?: boolean; onReload?: () => Promise<void>;
	brands?: readonly Pick<Brand, 'id' | 'name' | 'category'>[]; onCreateCollaboration?: CreateCollaboration;
}) {
	const task = useTask();
	const [editing, setEditing] = useState<Shoot | null>(null);
	const [formVersion, setFormVersion] = useState(0);
	const [cancel, setCancel] = useState<Shoot | null>(null);
	const [retry, setRetry] = useState<Shoot | null>(null);
	const [disconnect, setDisconnect] = useState(false);
	const reset = () => { setEditing(null); setFormVersion((value) => value + 1); };
	return <>
		<PageHeading eyebrow="SHOOT CALENDAR" title="Shoot calendar" description="Plan visits, keep shoot times together, and see what has reached Google Calendar." action={onReload && <button className="studio-button studio-button-secondary" style={control} disabled={busy} onClick={() => void task.run(onReload)}><RefreshCw size={16} aria-hidden="true" /> Reload calendar</button>} />
		<section className="studio-card" style={card} aria-labelledby="calendar-connection-heading">
			<h2 id="calendar-connection-heading">{view.demo ? 'Sample shoots only' : !view.configured ? 'Owner setup required' : view.connected ? 'Google Calendar connected' : view.reconnectRequired ? 'Reconnect Google Calendar' : 'Connect your calendar'}</h2>
			{view.demo ? <p>Local demo saves sample shoots on this computer. No Google reminders are sent, and a real Google account cannot be connected here.</p> : !view.configured ? <p>You can save shoots now. The owner needs to enable the Google Calendar API, register this site’s OAuth redirect, and set the server-only client credentials and encryption key. Ask the owner to follow the Google Calendar setup guide in the project documentation.</p> : <p>{view.connected ? 'New saves, reschedules and cancellations attempt Google sync automatically. Retry any pending shoots below, including shoots saved before connecting.' : 'Connect the Google account that should receive private shoot events. Planning still works without a connection.'}</p>}
			<p className="studio-muted">Google Calendar sends reminders. Allow notification permissions in Google Calendar and on your device. This studio does not send email or push notifications.</p>
			<div style={actions}>
				{!view.demo && view.configured && !view.connected && <button className="studio-button" style={control} disabled={busy || task.pending} onClick={() => void task.run(onConnect)}>Connect Google Calendar</button>}
				{!view.demo && view.connected && <button className="studio-button studio-button-secondary" style={control} disabled={busy} onClick={() => setDisconnect(true)}>Disconnect</button>}
			</div>
		</section>
		<ErrorNotice message={task.error} />
		<ShootPlanner key={`${editing?.id ?? 'new'}:${formVersion}`} collaborations={collaborations} brands={brands} onCreateCollaboration={onCreateCollaboration} editing={editing} busy={busy} onClose={reset} onSave={async (shoot, expectedRevision) => { await onAction({ action: 'save', shoot, expectedRevision }); reset(); }} />
		<section aria-labelledby="saved-shoots-heading"><h2 id="saved-shoots-heading">Saved shoots</h2>
			{!view.shoots.length ? <EmptyState title="No shoots planned yet" description="Use the form above to save your first visit or shoot." /> : <ul style={{ padding: 0, listStyle: 'none' }}>
				{view.shoots.map((shoot) => <li key={shoot.id} className="studio-card" style={card}>
					<div style={{ ...actions, justifyContent: 'space-between' }}><h3>{shoot.title}</h3><Badge tone={shoot.status === 'synced' ? 'sage' : shoot.status === 'error' ? 'amber' : 'neutral'}>{statusText(shoot)}</Badge></div>
					<p><time dateTime={shoot.startsAt}>{when(shoot)}</time></p>
					{shoot.location && <p>{shoot.location}</p>}
					<p className="studio-muted">Reminders: {reminderLabel(shoot.reminderMinutes)}{view.demo ? ' · preview only' : shoot.status !== 'synced' ? ' · awaiting Google sync' : ''}</p>
					{shoot.error && <p role="status">{shoot.error}</p>}
					<div style={actions}>
						{!shoot.cancelled && <><button className="studio-button studio-button-secondary" style={control} disabled={busy} aria-label={`Reschedule ${shoot.title}`} onClick={() => setEditing(shoot)}>Reschedule</button><button className="studio-button studio-button-quiet" style={control} disabled={busy} aria-label={`Cancel ${shoot.title}`} onClick={() => setCancel(shoot)}>Cancel shoot</button></>}
						{view.connected && view.configured && shoot.status !== 'cancelled' && <button className="studio-button studio-button-secondary" style={control} disabled={busy || task.pending} onClick={() => setRetry(shoot)}>{shoot.cancelled ? 'Retry deletion' : shoot.status === 'synced' ? 'Check Google sync' : 'Retry sync'}</button>}
					</div>
				</li>)}
			</ul>}
		</section>
		{cancel && <ConfirmDialog title="Cancel this shoot?" description={`${cancel.title} will stay in your studio history. If Google is connected, its matching app-created event will be deleted. A failed deletion remains visible for retry.`} confirmLabel="Cancel shoot" onClose={() => setCancel(null)} onConfirm={() => onAction({ action: 'cancel', id: cancel.id, expectedRevision: cancel.revision })} />}
		{retry && <ConfirmDialog title={retry.cancelled ? 'Retry Google deletion?' : 'Sync this shoot to Google?'} description={retry.cancelled ? 'Retry deleting the matching app-created event. The cancelled shoot stays in your studio history.' : 'Apply the latest saved studio details to the matching app-created event in your connected account. An event deleted in Google may be recreated; this is not a read-only check.'} confirmLabel={retry.cancelled ? 'Retry deletion' : 'Sync shoot'} onClose={() => setRetry(null)} onConfirm={() => onAction({ action: 'retry', id: retry.id })} />}
		{disconnect && <ConfirmDialog title="Disconnect Google Calendar?" description="Stored Google credentials will be removed and revocation attempted. Your studio shoots and existing Google events stay in place. Cancel any unwanted synced events before disconnecting. An already-sent request may still finish at Google." confirmLabel="Disconnect calendar" onClose={() => setDisconnect(false)} onConfirm={() => onAction({ action: 'disconnect' })} />}
	</>;
}

/** Use inside the authenticated Home only. Supply shoots to reuse a parent fetch, or omit to load privately. */
export function UpcomingShoots({ shoots, now, limit = 3 }: { shoots?: readonly Shoot[]; now?: string; limit?: number }) {
	const data = useCalendarData(shoots === undefined);
	const [clock] = useState(() => new Date().toISOString());
	const values = shoots ?? data.view?.shoots;
	const upcoming = upcomingShoots(values ?? [], now ?? clock, limit);
	return <section className="studio-card" style={card} aria-label="Upcoming shoots">
		<div style={{ ...actions, justifyContent: 'space-between' }}><h2><CalendarDays size={18} aria-hidden="true" /> Upcoming shoots</h2><Link className="studio-text-link" style={control} href="/studio/calendar">Plan a shoot</Link></div>
		{data.error ? <><ErrorNotice message={data.error} /><button className="studio-button studio-button-secondary" style={control} onClick={() => void data.reload()}>Retry loading shoots</button></> : !values ? <p role="status">Loading shoots…</p> : !upcoming.length ? <p>No upcoming shoots planned.</p> : <ul style={{ paddingLeft: 20 }}>{upcoming.map((shoot) => <li key={shoot.id} style={{ marginBlock: 12 }}><strong>{shoot.title}</strong><p>{when(shoot)}</p><small>{statusText(shoot)}</small></li>)}</ul>}
	</section>;
}

export function CalendarPage({ connectionResult }: { connectionResult?: 'connected' | 'failed' }) {
	const { state, mutate } = useStudio();
	const data = useCalendarData(true);
	const inFlight = useRef(false);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(() => connectionResult === 'failed' ? 'Google connection was not completed. Check owner setup and start again.' : connectionResult === 'connected' ? 'Google Calendar connected. Retry any shoots saved before connecting.' : null);
	async function action(body: CalendarAction) {
		if (inFlight.current) throw new Error('A calendar request is already running. Please wait.');
		inFlight.current = true; setBusy(true); setNotice(null);
		try {
			const result = await requestJSON<CalendarView & { notice?: string }>('/api/calendar', { method: 'POST', body: JSON.stringify(body) });
			data.accept(result);
			setNotice(result.notice ?? 'Studio changes are saved. Check the Google status on each shoot below.');
		} finally { inFlight.current = false; setBusy(false); }
	}
	async function connect() {
		if (inFlight.current) return;
		inFlight.current = true; setBusy(true);
		try {
			const { url } = await requestJSON<{ url: string }>('/api/calendar/connect', { method: 'POST', body: '{}' });
			const target = new URL(url);
			if (target.origin !== 'https://accounts.google.com') throw new Error('Unexpected Google connection destination.');
			window.location.assign(url);
		} finally { inFlight.current = false; setBusy(false); }
	}
	async function createCollaboration(input: NewCollaboration): Promise<CollaborationChoice> {
		const brand = await ensureBrand(state.brands, input.brandName, input.category, mutate, input.brandId);
		// A retry after a lost response must not create the same collaboration twice.
		if (!state.collaborations.some((item) => item.id === input.id)) await mutate({ type: 'collaboration.create', data: {
			id: input.id, brandId: brand.id, title: input.title, category: input.category.trim() || brand.category,
			stage: 'yet_to_visit', dueDate: '', image: '', reelUrl: '', description: '',
		} });
		return { id: input.id, title: input.title };
	}
	if (!data.view) return <section className="studio-card" style={card}><h1>Shoot calendar</h1>{data.error ? <><ErrorNotice message={data.error} /><Link href="/login">Sign in</Link><button className="studio-button" style={control} onClick={() => void data.reload()}>Try loading again</button></> : <p role="status">Loading private shoots…</p>}</section>;
	return <>{notice && <p className="studio-info-box" role="status">{notice}</p>}<ErrorNotice message={data.error} /><CalendarScreen view={data.view} collaborations={state.collaborations} brands={state.brands} onCreateCollaboration={createCollaboration} onAction={action} onConnect={connect} onReload={data.reload} busy={busy} /></>;
}