import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarScreen, ShootPlanner, UpcomingShoots } from '../../components/studio/calendar';
import type { CalendarView, Shoot } from '../../lib/calendar';

const shoot: Shoot = { id: 'shoot', collaborationId: 'work', title: 'Brand visit', startsAt: '2026-10-03T03:30:00.000Z', endsAt: '2026-10-03T04:30:00.000Z', timeZone: 'Asia/Kolkata', location: 'Private studio', reminderMinutes: [1440, 60], revision: 1, status: 'pending', error: null, cancelled: false };
const view: CalendarView = { configured: false, connected: false, demo: false, reconnectRequired: false, shoots: [shoot] };
const collaborations = [{ id: 'work', title: 'Brand visit' }];
const noop = async () => {};
const screen = (value: CalendarView) => renderToStaticMarkup(createElement(CalendarScreen, { view: value, collaborations, onAction: noop, onConnect: noop }));

describe('calendar UI presentation without replacing core components', () => {
  it('shows honest owner setup and Google/device reminder guidance, not a fake connect action', () => {
    const html = screen(view);
    expect(html).toContain('Owner setup required');
    expect(html).not.toContain('>Connect Google Calendar<');
    expect(html).toContain('Saved in studio');
    expect(html).toContain('Google Calendar sends reminders');
    expect(html).toContain('notification permissions');
    expect(html).toContain('not send email or push');
  });
  it('keeps demo planning available but never offers Google connection or real reminder claims', () => {
    const html = screen({ ...view, demo: true });
    expect(html).toContain('Sample shoots only');
    expect(html).not.toContain('>Connect Google Calendar<');
    expect(html).toContain('Plan a shoot');
    expect(html).toContain('No Google reminders');
  });
  it('keeps local disconnect available when setup disappears, without offering sync or reconnect', () => {
    const html = screen({ ...view, connected: true });
    expect(html).toContain('Owner setup required');
    expect(html).toContain('>Disconnect<');
    expect(html).not.toContain('>Connect Google Calendar<');
    expect(html).not.toContain('>Retry sync<');
  });
  it('renders a native, labeled planning form with India date/time values and 44px controls', () => {
    const html = renderToStaticMarkup(createElement(ShootPlanner, { collaborations, editing: shoot, onSave: noop, onClose: noop }));
    expect(html).toContain('type="date"'); expect(html).toContain('type="time"');
    expect(html).toContain('value="2026-10-03"'); expect(html).toContain('value="09:00"');
    expect(html).toContain('Asia/Kolkata'); expect(html).toContain('min-height:44px');
    expect(html).toContain('Title (optional)'); expect(html).toContain('Remind me');
  });
  it('offers inline collaboration and brand creation when a creator callback is supplied', () => {
    const create = async () => ({ id: 'new', title: 'New' });
    const fresh = renderToStaticMarkup(createElement(ShootPlanner, { collaborations: [], brands: [], onCreateCollaboration: create, onSave: noop, onClose: noop }));
    expect(fresh).toContain('New collaboration'); expect(fresh).toContain('name="brandName"'); expect(fresh).toContain('name="newTitle"');
    expect(fresh).not.toContain('Add a collaboration first');
    const rescheduling = renderToStaticMarkup(createElement(ShootPlanner, { collaborations, editing: shoot, onCreateCollaboration: create, onSave: noop, onClose: noop }));
    expect(rescheduling).not.toContain('New collaboration');
  });
  it('offers plain-language reminders with advanced minutes kept optional', () => {
    const html = renderToStaticMarkup(createElement(ShootPlanner, { collaborations, editing: shoot, onSave: noop, onClose: noop }));
    expect(html).toContain('Remind me');
    expect(html).toContain('1 day and 1 hour before');
    expect(html).toContain('Custom reminders');
    expect(screen(view)).toContain('Reminders: 1 day and 1 hour before');
    expect(screen(view)).not.toContain('1440, 60 minutes before');
  });
  it('distinguishes Google sync, retriable failure, and pending deletion, with reschedule/cancel/disconnect controls', () => {
    const html = screen({ ...view, configured: true, connected: true, shoots: [
      { ...shoot, status: 'synced' },
      { ...shoot, id: 'failed', title: 'Failed visit', status: 'error', error: 'Saved in studio; Google sync failed. Try again.' },
      { ...shoot, id: 'cancelled', cancelled: true, status: 'pending' },
    ] });
    expect(html).toContain('Google synced'); expect(html).toContain('Retry sync');
    expect(html).toContain('Retry deletion'); expect(html).toContain('Google deletion pending');
    expect(html).toContain('Reschedule'); expect(html).toContain('Cancel shoot'); expect(html).toContain('Disconnect');
  });
  it('exports a Home summary that excludes cancelled/past shoots and sorts upcoming shoots', () => {
    const html = renderToStaticMarkup(createElement(UpcomingShoots, { shoots: [
      { ...shoot, id: 'late', title: 'Later visit', startsAt: '2026-10-04T03:30:00.000Z', endsAt: '2026-10-04T04:30:00.000Z' },
      shoot, { ...shoot, id: 'cancelled', title: 'Cancelled visit', cancelled: true },
      { ...shoot, id: 'past', title: 'Past visit', startsAt: '2026-09-01T03:30:00.000Z', endsAt: '2026-09-01T04:30:00.000Z' },
    ], now: '2026-10-01T00:00:00Z' }));
    expect(html).toContain('Upcoming shoots'); expect(html).toContain('/studio/calendar');
    expect(html.indexOf('Brand visit')).toBeLessThan(html.indexOf('Later visit'));
    expect(html).not.toMatch(/Cancelled visit|Past visit/);
  });
});