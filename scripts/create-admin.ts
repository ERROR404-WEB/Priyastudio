import 'dotenv/config';
import { bootstrapAdmin } from '../src/server/bootstrap';
import { connectDatabase } from '../src/server/database';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !['postgres:', 'postgresql:'].includes(new URL(url).protocol)) throw new Error('Database required');
  const id = await bootstrapAdmin(connectDatabase(url), process.env);
  // The ID is not a credential. No phone/email/password/hash/session value is logged.
  console.log(`ADMIN_USER_ID=${id}`);
}
main().catch(() => {
  console.error('Admin bootstrap failed. Check migrations and ADMIN_PHONE (E.164), ADMIN_EMAIL, ADMIN_PASSWORD (8–128 characters). Existing admins are never overwritten.');
  process.exitCode = 1;
});