import { join } from 'node:path';
import { createDemoState } from '../lib/seed';
import type { StudioState } from '../lib/types';
import { getRuntimeConfig } from './config';
import { getDatabase } from './database';
import { FileAggregateStore } from './file-store';
import { mutateStore, type Mutation } from './persistence';
import { PostgresAggregateStore } from './postgres-store';

export { isDemo } from './config';
function store() {
  return getRuntimeConfig()
    ? new PostgresAggregateStore(getDatabase())
    : new FileAggregateStore(join(process.cwd(), '.data', 'studio.json'), createDemoState);
}
export async function getState(): Promise<StudioState> { return store().load(); }
export async function mutate(command: Mutation, actor: string): Promise<StudioState> { return mutateStore(store(), command, actor); }