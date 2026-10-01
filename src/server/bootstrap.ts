import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, phonePattern } from './auth';
import type { StudioDatabase } from './database';
import { HttpError } from './errors';
import { user } from './schema';

const credentials = z.object({
  ADMIN_PHONE: z.string().regex(phonePattern), ADMIN_EMAIL: z.email().max(254),
  ADMIN_PASSWORD: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

/** CLI-only: a single SQL statement claims the singleton and creates both credential rows. */
export async function bootstrapAdmin(db: StudioDatabase, environment: Record<string, string | undefined>): Promise<string> {
  const input = credentials.parse(environment);
  const id = randomUUID();
  const accountId = randomUUID();
  const passwordHash = await hashPassword(input.ADMIN_PASSWORD);
  await db.execute(sql`
    WITH claim AS (
      INSERT INTO studio_bootstrap (id, user_id) VALUES ('admin', ${id})
      ON CONFLICT DO NOTHING RETURNING user_id
    ), created_user AS (
      INSERT INTO auth_user (id, name, email, email_verified, username, display_username)
      SELECT user_id, 'Priya', ${input.ADMIN_EMAIL.toLowerCase()}, false, ${input.ADMIN_PHONE}, ${input.ADMIN_PHONE}
      FROM claim RETURNING id
    )
    INSERT INTO auth_account (id, account_id, provider_id, user_id, password)
    SELECT ${accountId}, id, 'credential', id, ${passwordHash} FROM created_user
  `);
  const [created] = await db.select({ id: user.id }).from(user).where(eq(user.id, id));
  if (!created) throw new HttpError(409, 'An administrator has already been bootstrapped; no credentials were changed');
  return created.id;
}