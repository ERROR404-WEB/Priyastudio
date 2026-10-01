import { sql } from 'drizzle-orm';
import type { StudioDatabase } from './database';
import { getDatabase } from './database';
import { getRuntimeConfig } from './config';
import { HttpError } from './errors';
import { rateBuckets } from './schema';

const local = new Map<string, { hits: number; resetAt: number }>();

/** One UPSERT, using the database clock: atomic across serverless instances. */
export async function consumeDatabaseLimit(db: StudioDatabase, key: string, max: number, seconds: number): Promise<void> {
  const reset = sql`now() + (${seconds} * interval '1 second')`;
  const [bucket] = await db.insert(rateBuckets).values({ key, hits: 1, resetAt: reset })
    .onConflictDoUpdate({ target: rateBuckets.key, set: {
      hits: sql`CASE WHEN ${rateBuckets.resetAt} <= now() THEN 1 ELSE LEAST(${rateBuckets.hits} + 1, 1000000000) END`,
      resetAt: sql`CASE WHEN ${rateBuckets.resetAt} <= now() THEN ${reset} ELSE ${rateBuckets.resetAt} END`,
    } }).returning({ hits: rateBuckets.hits });
  if (bucket.hits > max) throw new HttpError(429, 'Too many requests; try again later');
}

export async function rateLimit(key: string, max: number, seconds = 60): Promise<void> {
  if (getRuntimeConfig()) return consumeDatabaseLimit(getDatabase(), key, max, seconds);
  // Only localhost demo uses memory; never claim cross-process enforcement in demo.
  const now = Date.now();
  for (const [name, bucket] of local) if (bucket.resetAt <= now) local.delete(name);
  const bucket = local.get(key) ?? { hits: 0, resetAt: now + seconds * 1000 };
  bucket.hits += 1; local.set(key, bucket);
  if (bucket.hits > max) throw new HttpError(429, 'Too many requests; try again later');
}