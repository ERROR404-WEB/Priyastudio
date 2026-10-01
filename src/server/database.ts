import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { getRuntimeConfig } from './config';
import { HttpError } from './errors';
import * as schema from './schema';

export type StudioDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
let cached: { url: string; db: ReturnType<typeof connectDatabase> } | undefined;

/** Neon HTTP performs real PostgreSQL queries; constructing the adapter never opens a connection. */
export function connectDatabase(url: string) {
  return drizzle(neon(url), { schema });
}
export function getDatabase() {
  const config = getRuntimeConfig();
  if (!config) throw new HttpError(503, 'Database is not configured');
  if (!cached || cached.url !== config.databaseUrl) cached = { url: config.databaseUrl, db: connectDatabase(config.databaseUrl) };
  return cached.db;
}