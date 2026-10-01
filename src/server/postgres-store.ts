import { and, eq } from 'drizzle-orm';
import { createEmptyState } from '../lib/seed';
import type { StudioState } from '../lib/types';
import type { StudioDatabase } from './database';
import type { AggregateStore } from './persistence';
import { studio } from './schema';

export class PostgresAggregateStore implements AggregateStore {
  constructor(private readonly db: StudioDatabase) {}
  async load(): Promise<StudioState> {
    let [row] = await this.db.select().from(studio).where(eq(studio.id, 'studio'));
    if (!row) {
      await this.db.insert(studio).values({ id: 'studio', revision: 0, state: createEmptyState() }).onConflictDoNothing();
      [row] = await this.db.select().from(studio).where(eq(studio.id, 'studio'));
    }
    if (!row || row.revision !== row.state.revision) throw new Error('Invalid stored revision');
    return row.state;
  }
  async compareAndSwap(expectedRevision: number, next: StudioState): Promise<boolean> {
    const updated = await this.db.update(studio).set({ revision: next.revision, state: next })
      .where(and(eq(studio.id, 'studio'), eq(studio.revision, expectedRevision))).returning({ id: studio.id });
    return updated.length === 1;
  }
}