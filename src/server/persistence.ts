import { ZodError } from 'zod';
import { applyCommand } from '../lib/domain';
import type { Command, StudioState } from '../lib/types';
import { HttpError } from './errors';

export interface AggregateStore {
  load(): Promise<StudioState>;
  compareAndSwap(expectedRevision: number, next: StudioState): Promise<boolean>;
}
/** Pure callback: called again with fresh state/time after every conflict. Never perform IO in it. */
export type Mutation = Command | ((state: StudioState, now: string) => Command);

export async function mutateStore(store: AggregateStore, input: Mutation, actor: string, attempts = 12): Promise<StudioState> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await store.load();
    const now = new Date().toISOString();
    let next: StudioState;
    try {
      const command = typeof input === 'function' ? input(current, now) : input;
      next = applyCommand(current, command, actor, now);
    } catch (error) {
      if (error instanceof HttpError || error instanceof ZodError) throw error;
      // Domain messages contain rule descriptions, never submitted field values.
      throw new HttpError(422, error instanceof Error ? error.message : 'Invalid mutation');
    }
    // Even no-op commands check the revision: capability validation must be linearizable.
    if (await store.compareAndSwap(current.revision, next)) return next;
  }
  throw new HttpError(409, 'The workspace changed; retry your request');
}