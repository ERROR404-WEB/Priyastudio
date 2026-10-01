import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { Shoot } from '../lib/calendar';
import type { StudioState } from '../lib/types';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const user = pgTable('auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
  username: text('username').unique(), displayUsername: text('display_username'),
});
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(), expiresAt: time('expires_at').notNull(), token: text('token').notNull().unique(),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('auth_session_user_idx').on(table.userId)]);
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: time('access_token_expires_at'), refreshTokenExpiresAt: time('refresh_token_expires_at'),
  scope: text('scope'), password: text('password'),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [index('auth_account_user_idx').on(table.userId)]);
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: time('expires_at').notNull(), createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [index('auth_verification_identifier_idx').on(table.identifier)]);
export const studio = pgTable('studio', {
  id: text('id').primaryKey(), revision: integer('revision').notNull(), state: jsonb('state').$type<StudioState>().notNull(),
}, (table) => [check('studio_singleton', sql`${table.id} = 'studio'`), check('studio_revision_matches', sql`${table.revision} >= 0 AND (${table.state}->>'revision')::integer = ${table.revision}`)]);
export const rateBuckets = pgTable('studio_rate_bucket', {
  key: text('key').primaryKey(), hits: integer('hits').notNull(), resetAt: time('reset_at').notNull(),
});
// A single claim row makes concurrent bootstrap attempts atomic without creating a public signup route.
export const bootstrap = pgTable('studio_bootstrap', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
}, (table) => [check('bootstrap_singleton', sql`${table.id} = 'admin'`)]);

// Calendar privacy boundary: these tables are never part of StudioState or its JSON export.
export const calendarConnections = pgTable('calendar_connection', {
  ownerId: text('owner_id').primaryKey(), namespace: text('namespace').notNull().unique(),
  epoch: integer('epoch').notNull().default(0), credentials: text('credentials'),
  reconnectRequired: boolean('reconnect_required').notNull().default(false),
  leaseToken: text('lease_token'), leaseUntil: time('lease_until').notNull().defaultNow(),
  blockedUntil: time('blocked_until').notNull().defaultNow(),
}, (table) => [check('calendar_epoch_valid', sql`${table.epoch} >= 0`)]);
export const calendarShoots = pgTable('calendar_shoot', {
  ownerId: text('owner_id').notNull().references(() => calendarConnections.ownerId),
  id: text('id').notNull(), revision: integer('revision').notNull(), body: jsonb('body').$type<Shoot>().notNull(),
  eventGeneration: integer('event_generation').notNull().default(0), syncedEpoch: integer('synced_epoch'),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.id] }),
  check('calendar_shoot_valid', sql`coalesce(
    ${table.revision} > 0 AND ${table.eventGeneration} >= 0 AND (${table.syncedEpoch} IS NULL OR ${table.syncedEpoch} >= 0)
    AND jsonb_typeof(${table.body}) = 'object'
    AND ${table.body} ?& ARRAY['id', 'collaborationId', 'title', 'startsAt', 'endsAt', 'timeZone', 'location', 'reminderMinutes', 'revision', 'cancelled', 'status', 'error']
    AND ${table.body} - ARRAY['id', 'collaborationId', 'title', 'startsAt', 'endsAt', 'timeZone', 'location', 'reminderMinutes', 'revision', 'cancelled', 'status', 'error'] = '{}'::jsonb
    AND jsonb_typeof(${table.body}->'id') = 'string' AND ${table.body}->>'id' = ${table.id} AND ${table.id} ~ '^[A-Za-z0-9_-]{1,100}$'
    AND jsonb_typeof(${table.body}->'collaborationId') = 'string' AND ${table.body}->>'collaborationId' ~ '^[A-Za-z0-9_-]{1,100}$'
    AND jsonb_typeof(${table.body}->'revision') = 'number' AND (${table.body}->>'revision')::numeric = ${table.revision}
    AND jsonb_typeof(${table.body}->'title') = 'string' AND length(${table.body}->>'title') <= 200
    AND jsonb_typeof(${table.body}->'location') = 'string' AND length(${table.body}->>'location') <= 500
    AND ${table.body}->>'timeZone' = 'Asia/Kolkata'
    AND jsonb_typeof(${table.body}->'startsAt') = 'string' AND ${table.body}->>'startsAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND jsonb_typeof(${table.body}->'endsAt') = 'string' AND ${table.body}->>'endsAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND (${table.body}->>'startsAt')::timestamptz < (${table.body}->>'endsAt')::timestamptz
    AND jsonb_typeof(${table.body}->'cancelled') = 'boolean'
    AND ${table.body}->>'status' IN ('pending', 'synced', 'error', 'cancelled')
    AND (${table.body}->>'status' <> 'cancelled' OR ${table.body}->'cancelled' = 'true'::jsonb)
    AND (${table.body}->>'status' <> 'synced' OR ${table.body}->'cancelled' = 'false'::jsonb)
    AND jsonb_typeof(${table.body}->'error') IN ('null', 'string')
    AND jsonb_typeof(${table.body}->'reminderMinutes') = 'array' AND jsonb_array_length(${table.body}->'reminderMinutes') <= 5
    AND NOT jsonb_path_exists(${table.body}, '$.reminderMinutes[*] ? (@.type() != "number" || @ < 0 || @ > 40320 || @ % 1 != 0)')
  , false)`),
]);
export const calendarOAuthStates = pgTable('calendar_oauth_state', {
  ownerId: text('owner_id').primaryKey().references(() => calendarConnections.ownerId),
  stateHash: text('state_hash').notNull().unique(), browserHash: text('browser_hash').notNull(),
  epoch: integer('epoch').notNull(), verifier: text('verifier').notNull(), expiresAt: time('expires_at').notNull(),
});