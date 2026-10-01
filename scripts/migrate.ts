import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { migrationStatements } from '../src/server/migrations';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !['postgres:', 'postgresql:'].includes(new URL(url).protocol)) throw new Error('Missing database configuration');
  // Explicit statement boundaries preserve SQL literals/comments; all DDL is committed together.
  const statements: string[] = [];
  for (const file of ['0000_studio.sql', '0001_calendar.sql', '0002_calendar_validation.sql']) {
    statements.push(...migrationStatements(await readFile(resolve(process.cwd(), 'drizzle', file), 'utf8')));
  }
  const client = neon(url);
  await client.transaction(statements.map((statement) => client.query(statement, [])));
  console.log('Schema is ready (idempotent migration applied).');
}
main().catch(() => { console.error('Migration failed. Check DATABASE_URL and database access; no schema reset was attempted.'); process.exitCode = 1; });