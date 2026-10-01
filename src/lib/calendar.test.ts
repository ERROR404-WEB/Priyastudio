import { describe, expect, it } from 'vitest';
import { eventId, googleEvent, indiaDateTime, localShootTime, parseShoot, upcomingShoots } from './calendar';

const input = { id: 'shoot-1', collaborationId: 'work-1', startsAt: '2026-10-03T09:00:00+05:30', endsAt: '2026-10-03T10:30:00+05:30', location: 'Private studio' };
describe('private shoot calendar contract', () => {
  it('converts native India date/time without relying on the server or browser timezone', () => {
    expect(indiaDateTime('2026-10-03', '09:00')).toBe('2026-10-03T03:30:00.000Z');
    expect(localShootTime('2026-10-03T03:30:00Z')).toEqual({ date: '2026-10-03', time: '09:00' });
    expect(() => indiaDateTime('2026-02-30', '09:00')).toThrow();
    expect(() => indiaDateTime('2026-10-03', '24:00')).toThrow();
  });
  it('defaults title, timezone and Google reminders and canonicalizes RFC3339 instants', () => {
    expect(parseShoot(input, [{ id: 'work-1', title: 'Brand visit' }])).toEqual({
      ...input, title: 'Brand visit', timeZone: 'Asia/Kolkata', reminderMinutes: [1440, 60],
      startsAt: '2026-10-03T03:30:00.000Z', endsAt: '2026-10-03T05:00:00.000Z',
    });
  });
  it.each([
    { startsAt: '2026-10-03T09:00:00' }, { startsAt: '2026-02-30T09:00:00Z' }, { startsAt: '2026-10-03T09:00Z' },
    { endsAt: input.startsAt }, { endsAt: '2026-10-02T10:00:00Z' },
    { timeZone: 'UTC' }, { reminderMinutes: [-1] }, { reminderMinutes: [40321] },
    { reminderMinutes: [60, 60] }, { reminderMinutes: [1.5] }, { reminderMinutes: [1, 2, 3, 4, 5, 6] },
    { collaborationId: 'missing' }, { accessToken: 'never accepted' },
  ])('rejects invalid schedules %j', (change) => {
    expect(() => parseShoot({ ...input, ...change }, [{ id: 'work-1', title: 'Brand visit' }])).toThrow();
  });
  it('has deterministic base32hex-compatible identities, isolated by owner and generation', () => {
    expect(eventId('owner', 'shoot-1', 0)).toBe('hp6f776e65723a73686f6f742d313a30');
    expect(eventId('owner', 'shoot-1', 1)).not.toBe(eventId('owner', 'shoot-1', 0));
    expect(eventId('other', 'shoot-1', 0)).not.toBe(eventId('owner', 'shoot-1', 0));
    expect(eventId('owner', 'shoot-1', 0)).toMatch(/^[0-9a-v]{5,1024}$/);
  });
  it('builds a private event without attendees, app delivery claims, or arbitrary client fields', () => {
    const shoot = { ...parseShoot(input, [{ id: 'work-1', title: 'Brand visit' }]), revision: 2, status: 'pending' as const, cancelled: false, error: null };
    expect(googleEvent(shoot, 'namespace')).toEqual({
      summary: 'Brand visit', location: 'Private studio', visibility: 'private',
      start: { dateTime: '2026-10-03T03:30:00.000Z', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-10-03T05:00:00.000Z', timeZone: 'Asia/Kolkata' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] },
      extendedProperties: { private: { app: 'hey-priya-studio', owner: 'namespace', schedule: 'shoot-1', revision: '2' } },
    });
    expect(upcomingShoots([shoot, { ...shoot, id: 'cancelled', cancelled: true }], '2026-10-03T04:00:00Z')).toEqual([shoot]);
    expect(upcomingShoots([shoot], '2026-10-03T05:00:00Z')).toEqual([]);
  });
});