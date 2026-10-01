import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parseShoot } from '../../lib/calendar';
import * as schema from '../schema';
import { migrationStatements } from '../migrations';
import { CalendarRepository } from './repository';

async function apply(pg: PGlite, file: string) {
  for (const statement of migrationStatements(await readFile(new URL(`../../../drizzle/${file}`, import.meta.url), 'utf8'))) await pg.exec(statement);
}
async function oldDatabase() {
  const pg = new PGlite();
  await apply(pg, '0000_studio.sql'); await apply(pg, '0001_calendar.sql');
  const db = drizzle(pg, { schema });
  const repo = new CalendarRepository(db);
  const input = parseShoot({ id: 'kept', collaborationId: 'work', startsAt: '2026-10-03T09:00:00+05:30', endsAt: '2026-10-03T10:00:00+05:30' }, [{ id: 'work', title: 'Keep this shoot' }]);
  await repo.save('owner', input, 0);
  await db.execute(sql`UPDATE calendar_connection SET credentials = 'opaque-encrypted-fixture' WHERE owner_id = 'owner'`);
  return { pg, db, repo };
}
const constraintDefinition = (pg: PGlite) => pg.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'calendar_shoot'::regclass AND conname = 'calendar_shoot_valid'`);

describe('non-destructive calendar validation upgrade', () => {
  it('upgrades existing data, reruns safely, and matches the executable Drizzle check', async () => {
    const { pg, db, repo } = await oldDatabase();
    try {
      const shoot = await repo.get('owner', 'kept'); const connection = await repo.connection('owner');
      for (let run = 0; run < 2; run++) await apply(pg, '0002_calendar_validation.sql');
      expect(await repo.get('owner', 'kept')).toEqual(shoot);
      expect(await repo.connection('owner')).toEqual(connection);
      const migrated = await constraintDefinition(pg);
      const check = getTableConfig(schema.calendarShoots).checks.find((item) => item.name === 'calendar_shoot_valid')!;
      await db.execute(sql`ALTER TABLE calendar_shoot DROP CONSTRAINT calendar_shoot_valid, ADD CONSTRAINT calendar_shoot_valid CHECK (${check.value})`);
      expect((await constraintDefinition(pg)).rows).toEqual(migrated.rows);
      await expect(db.execute(sql`UPDATE calendar_shoot SET body = '{}' WHERE owner_id = 'owner'`)).rejects.toThrow();
      expect(await repo.get('owner', 'kept')).toEqual(shoot);
    } finally { await pg.close(); }
  }, 30_000);
  it('aborts atomically on invalid legacy data, retaining both the data and original constraint', async () => {
    const { pg, db } = await oldDatabase();
    try {
      const original = await constraintDefinition(pg);
      await db.execute(sql`UPDATE calendar_shoot SET body = '{}' WHERE owner_id = 'owner'`);
      await expect(apply(pg, '0002_calendar_validation.sql')).rejects.toThrow();
      expect((await pg.query(`SELECT body FROM calendar_shoot WHERE owner_id = 'owner'`)).rows).toEqual([{ body: {} }]);
      expect((await constraintDefinition(pg)).rows).toEqual(original.rows);
    } finally { await pg.close(); }
  }, 30_000);
});