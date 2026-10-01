import type { Shoot, ShootInput } from '../../lib/calendar';
import { HttpError } from '../errors';

export interface StoredShoot { shoot: Shoot; eventGeneration: number; syncedEpoch: number | null }
export interface Lease { owner: string; token: string; epoch: number; namespace: string; credentials: string | null }
export function pendingShoot(input: ShootInput, revision: number): Shoot {
  return { ...input, revision, cancelled: false, status: 'pending', error: null };
}
export function sameInput(shoot: Shoot, input: ShootInput): boolean {
  return !shoot.cancelled && Object.keys(input).every((key) => JSON.stringify(shoot[key as keyof ShootInput]) === JSON.stringify(input[key as keyof ShootInput]));
}
export function conflict(): never { throw new HttpError(409, 'This shoot changed. Refresh before saving again.'); }