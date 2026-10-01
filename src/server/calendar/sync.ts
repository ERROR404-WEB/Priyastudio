import { eventId, googleEvent } from '../../lib/calendar';
import type { CalendarConfig } from './config';
import { CredentialVault, LeaseLost } from './credentials';
import { GoogleFailure, type EventRequest, type GoogleTransport, type RemoteEvent } from './google';
import type { Lease, StoredShoot } from './model';
import type { CalendarRepository } from './repository';

class ScheduleChanged extends Error {}
class OwnershipConflict extends Error {}
function assertOwned(event: RemoteEvent | undefined, id: string, value: StoredShoot, lease: Lease): asserts event is RemoteEvent & { etag: string } {
  const marker = event?.extendedProperties?.private;
  if (!event || event.id !== id || !event.etag || marker?.app !== 'hey-priya-studio' || marker.owner !== lease.namespace || marker.schedule !== value.shoot.id
    || !/^\d+$/.test(marker.revision ?? '') || Number(marker.revision) > value.shoot.revision || event.attendees?.length) throw new OwnershipConflict();
}

/** External effects never execute inside aggregate mutation/CAS callbacks. */
export async function synchronize(repo: CalendarRepository, config: CalendarConfig, google: GoogleTransport, owner: string, scheduleId: string): Promise<void> {
  const acquired = await repo.claim(owner);
  if (!acquired) return; // The saved revision is still pending; another request holds the durable lease.
  const lease: Lease = acquired;
  const vault = new CredentialVault(repo, config, google);
  try {
    if (!lease.credentials) return;
    // Bounded reconciliation; lease validity is checked again before EVERY external request.
    for (let attempt = 0; attempt < 6; attempt++) {
      const value = await repo.get(owner, scheduleId);
      if (!value) return;
      const id = eventId(lease.namespace, scheduleId, value.eventGeneration);
      async function request(method: EventRequest['method'], body?: object, etag?: string) {
        const accessToken = await vault.access(lease);
        const latest = await repo.get(owner, scheduleId);
        if (latest?.shoot.revision !== value!.shoot.revision || latest.eventGeneration !== value!.eventGeneration) throw new ScheduleChanged();
        if (!await repo.valid(lease)) throw new LeaseLost();
        let response = await google.event({ method, id, accessToken, body, etag });
        if (response.status === 401) {
          const refreshed = await vault.access(lease, true);
          const current = await repo.get(owner, scheduleId);
          if (current?.shoot.revision !== value!.shoot.revision || current.eventGeneration !== value!.eventGeneration) throw new ScheduleChanged();
          if (!await repo.valid(lease)) throw new LeaseLost();
          response = await google.event({ method, id, accessToken: refreshed, body, etag });
          if (response.status === 401) throw new GoogleFailure(true);
        }
        return response;
      }
      try {
        const remote = await request('GET');
        const tombstone = remote.status === 410 || (remote.status === 200 && remote.event?.status === 'cancelled');
        if (tombstone) {
          if (value.shoot.cancelled) { if (await repo.finish(lease, value, 'cancelled', null)) return; }
          else await repo.advanceGeneration(lease, value);
          continue;
        }
        if (remote.status === 404) {
          if (value.shoot.cancelled) { if (await repo.finish(lease, value, 'cancelled', null)) return; continue; }
          const created = await request('POST', googleEvent(value.shoot, lease.namespace));
          if (created.status === 409 || created.status === 410) continue; // Read and verify; never blindly overwrite a collision.
          if (created.status < 200 || created.status >= 300) throw new GoogleFailure();
          assertOwned(created.event, id, value, lease);
        } else {
          if (remote.status !== 200) throw new GoogleFailure();
          assertOwned(remote.event, id, value, lease);
          const updated = await request(value.shoot.cancelled ? 'DELETE' : 'PATCH', value.shoot.cancelled ? undefined : googleEvent(value.shoot, lease.namespace), remote.event.etag);
          if ([404, 409, 410, 412].includes(updated.status)) continue;
          if (updated.status < 200 || updated.status >= 300) throw new GoogleFailure();
          if (!value.shoot.cancelled) assertOwned(updated.event, id, value, lease);
        }
        if (await repo.finish(lease, value, value.shoot.cancelled ? 'cancelled' : 'synced', null)) return;
        // A newer studio save arrived during IO. Re-read it under the same lease; never mark the old one synced.
      } catch (error) {
        if (error instanceof ScheduleChanged) continue;
        if (error instanceof LeaseLost) return;
        if (error instanceof GoogleFailure && error.revoked) { await vault.invalidate(lease); return; }
        const message = error instanceof OwnershipConflict
          ? 'Google event ownership or version could not be verified. Nothing was overwritten. Review the event before retrying.'
          : value.shoot.cancelled ? 'Cancelled in studio; Google deletion is not confirmed. Retry deletion.' : 'Saved in studio; Google sync failed. Try again.';
        if (await repo.finish(lease, value, 'error', message)) return;
      }
    }
    const latest = await repo.get(owner, scheduleId);
    if (latest) await repo.finish(lease, latest, 'error', 'Saved in studio; the calendar kept changing. Retry sync.');
  } finally { await repo.release(lease); }
}