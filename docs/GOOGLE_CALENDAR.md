# Shoot calendar: owner setup and operational contract

The private calendar is available at `/studio/calendar` in the main navigation and on Home as **Upcoming shoots**. Planning works without Google configuration; automatic Google sync starts after owner setup/connection. It uses the existing studio owner login, **not** Google sign-in as a replacement for studio authentication. The planner defaults to **1 day and 1 hour before**, with other readable presets and optional custom reminder minutes.

## Owner setup

1. Finish the database and single-admin setup in [README.md](../README.md). Back up the intended database, then run `npm run db:migrate` in the private configured environment. [scripts/migrate.ts](../scripts/migrate.ts) applies the initial studio migration, [drizzle/0001_calendar.sql](../drizzle/0001_calendar.sql), and [drizzle/0002_calendar_validation.sql](../drizzle/0002_calendar_validation.sql) together in a Neon transaction. They are rerunnable and are not executed during build/startup.
2. Create a dedicated Google Cloud project (avoid sharing its OAuth grant with unrelated apps) and enable **Google Calendar API**. Configure the Google Auth Platform branding, support/developer contacts, audience and data access. Supply the privacy/domain information Google requires for your audience.
3. Request only `https://www.googleapis.com/auth/calendar.events.owned`. This permits events on calendars the consenting account owns; it is **not** a Google-enforced app-only scope. The application further restricts requests to known app event IDs in the account's **primary** calendar and verifies private ownership markers before updates/deletes. It does not list unrelated events or invite guests.
4. For external **Testing**, add the intended Google account as a test user. Calendar refresh tokens issued in this mode expire after **seven days**. For ongoing use, review Google's publishing and verification requirements; selecting Production alone does not imply verification. Workspace policies may require administrator approval. Internal audience is only appropriate for the eligible Workspace organization.
5. Create an OAuth client of type **Web application**, not a desktop client, API key or service account. Register the exact redirect `https://YOUR-SITE/api/calendar/callback`, with the same scheme, host and port as `BETTER_AUTH_URL`, and no trailing slash. No wildcard redirect. The application derives this value; there is no separate redirect environment variable. Use separate sites/databases/keys/OAuth clients for previews. An authenticated, database-backed localhost environment may register `http://localhost:3000/api/calendar/callback`; the unauthenticated local demo can never connect.
6. Configure the three optional server/runtime variables below in your hosting secret manager. Generate **32 cryptographically random bytes** locally with an OS CSPRNG, encode them as standard padded base64, and store that value as the encryption key. This is typically 44 characters ending in `=`. Do not use a password, hexadecimal text, base64url, a test fixture or a key supplied through chat. Do not log the generated value. Keep a secure recovery copy separately from database backups.
7. Restart/redeploy to load configuration. Sign in as the configured studio owner, visit `/studio/calendar`, select **Connect Google Calendar**, and consent in the same browser within ten minutes. Select the account whose primary calendar should receive shoots; no account-picker/calendar-selector is provided inside the studio.
8. Retry any shoots saved before connecting. New saves/reschedules/cancellations attempt sync automatically. Verify a disposable event with the account owner's consent before relying on reminders. Google Calendar and device/browser notifications must be enabled; the app does not send email, SMS or push notifications.

### Server-only environment variables

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | Existing PostgreSQL/Neon runtime configuration, required for real Google connection |
| `BETTER_AUTH_SECRET` | Existing random studio authentication secret, at least 32 characters |
| `BETTER_AUTH_URL` | Existing canonical site origin; HTTPS in production; also derives the OAuth callback |
| `ADMIN_USER_ID` | Existing authorized single-admin ID |
| `GOOGLE_CALENDAR_CLIENT_ID` | Web OAuth client ID from the dedicated Google project |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Matching private OAuth client secret |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Canonical base64 encoding of 32 random bytes for AES-256-GCM |

See [.env.example](../.env.example). Never use `NEXT_PUBLIC_` prefixes. Missing/invalid Google configuration disables only Google operations, not PostgreSQL planning. Missing core production configuration returns 503 rather than falling back to demo. No database in non-production means loopback-only synthetic schedules, stored separately from the studio aggregate; even setting all Google variables cannot enable real OAuth in that mode.

## API contract

Implemented by [src/server/calendar/handlers.ts](../src/server/calendar/handlers.ts) and private Next route handlers. JSON success responses are direct objects; errors are `{ error: string }`. All responses use `no-store`, `no-referrer`, noindex and nosniff headers. Real owner sessions are checked against `ADMIN_USER_ID` without the cookie session cache. POSTs also require an exact same-origin `Origin` and `application/json` body.

| Method/path | Request | Response/behavior |
|---|---|---|
| `GET /api/calendar` | No body | `CalendarView` with `configured`, `connected`, `demo`, `reconnectRequired`, `shoots` |
| `POST /api/calendar` | `{ action: 'save', expectedRevision, shoot }` | Validates an existing collaboration; durably saves first, then attempts sync; returns view |
| `POST /api/calendar` | `{ action: 'cancel', id, expectedRevision }` | Retains shoot history, increments revision, attempts deletion of the matching app event |
| `POST /api/calendar` | `{ action: 'retry', id }` | Reconciles the **latest** saved revision; can create/update/recreate/delete an event; not read-only |
| `POST /api/calendar` | `{ action: 'disconnect' }` | Deletes local stored credentials, fences old operations, attempts revocation; returns view plus `notice`; never deletes events |
| `POST /api/calendar/connect` | `{}` | `{ url }` for official Google authorization; sets ten-minute browser-binding cookie, not a token cookie |
| `GET /api/calendar/callback` | Google's `state`, `code` or `error` | Owner authentication + one-use browser-bound state + PKCE; 303 to `/studio/calendar?connection=connected` or `failed`; missing session goes to `/login` |

`ShootInput`: `id`, `collaborationId` (1–100 ASCII letters/digits/underscore/hyphen), optional `title` (up to 200 characters, defaults to collaboration title), offset-qualified ISO `startsAt`/`endsAt`, `timeZone` fixed to `Asia/Kolkata`, optional `location` (up to 500 characters), and `reminderMinutes` (up to five unique integers from 0 to 40320, default `[1440, 60]`, empty list disables reminders). Instants are normalized to UTC ISO strings; end must follow start. Unknown fields are rejected. A returned `Shoot` additionally has `revision`, `cancelled`, `status` and nullable sanitized `error`.

Use `expectedRevision: 0` only for create, and the last returned revision for save/cancel. A replay of the identical just-saved request is accepted without duplicating it. Stale different edits return 409; refresh and reconcile rather than replacing the stored winner. Cancelled IDs cannot be resurrected. An HTTP 200 means the studio action succeeded, **not** necessarily that Google succeeded: inspect each shoot's status.

- `configured`: Google settings passed local validation, not proof of live credentials or Google availability.
- `connected`: encrypted credentials exist locally. This remains true if owner configuration disappears, so **Disconnect stays available**. It is not a live token validation result.
- `pending`: saved locally, Google state not currently confirmed. Stored `synced` rows project as pending if setup/connection is absent or the connection epoch changed.
- `synced`: the current revision was confirmed at Google for this connection epoch. There is no continuous remote monitoring.
- `error`: retriable Google problem or reconnect required; studio data is retained. `cancelled: true` with pending/error means remote deletion is unconfirmed.
- `cancelled`: deletion/absence confirmed (or synthetic demo cancellation), with history retained.

Typical failures: 400 malformed/unknown JSON, 401 missing login, 403 non-owner/cross-origin/demo Google access, 404 unknown shoot, 409 stale revision/disconnected/busy, 413 oversized body, 415 wrong content type, 422 missing collaboration, 429 limit exceeded, 503 missing setup/unavailable service. Private body cap is 16 KiB; connect cap is 1 KiB. Database-backed per-owner limits per 60 seconds: read 240, write 120, connect 10, callback 20. Rate-limited JSON responses include `Retry-After: 60`.

## Security, consistency and recovery

- The three calendar tables are separate from `StudioState`, public projections, shares and JSON exports. Schedules/locations are private access-controlled database data, **not application-encrypted**. Credentials and PKCE verifier are versioned AES-256-GCM envelopes with random IVs and owner/epoch or consent context binding. Protect database backups and their retention separately.
- Consent state and browser nonce are stored as hashes; state is consumed atomically once, expires in ten minutes, and is tied to the authenticated owner and connection epoch. Cookies are HttpOnly, SameSite=Lax, scoped to `/api/calendar`, and Secure with a secure-prefixed name on HTTPS. Starting another consent replaces the previous one. Denial, wrong binding, expiration or missing required token scope cannot link an account.
- Exchange/refresh/revocation use official `google-auth-library` **11.1.0** (registry version rechecked 2026-10-01, no dependency change in finishing pass). Tokens stay server-side. Refresh replacements and revoked-grant invalidations are fenced by the durable lease. Late OAuth/refresh responses cannot restore credentials after disconnect; an expired worker cannot invalidate its replacement.
- Writes use revision compare-and-swap. Per-owner 180-second database leases serialize Google work; requests stop using a lease with less than 15 seconds left. Event requests have ten-second timeouts and verify revision/lease again before each send. Reconciliation is bounded to six attempts; remaining changes stay pending or error for an explicit retry. A different shoot blocked by another shoot's lease is not automatically drained later.
- Event IDs are deterministic for owner namespace, shoot and generation. Lost create responses/409 collisions cause a fresh read. Updates/deletes require matching app/owner/shoot markers, a non-newer revision, no guests and a verified ETag; conditional writes prevent delayed workers overwriting newer events. Google tombstones advance a durable ID generation before recreation. An already-sent request can still finish remotely after disconnect/timeout; no distributed atomicity is claimed.
- Google is an outbound projection, not two-way sync. Editing/deleting an event in Google does not change studio data. **Check Google sync** and retry apply the latest studio details and may recreate an event. The UI confirms retries, cancellations and disconnect. No webhook, cron, background retry queue, automatic backfill-on-connect or delivery guarantee exists.
- Disconnect removes local credentials even when configuration/key is absent or revocation fails, returns an honest notice, and leaves all Google events intact. For an unconfirmed revocation, remove access in [Google Account connections](https://myaccount.google.com/permissions). Revocation may affect other clients/scopes in the same Google project, another reason to use a dedicated project. Cancel unwanted events before disconnecting. Reconnecting a different Google account does not clean up the old account's events.
- Keep the encryption key stable. Rotate by disconnecting while the old key still works, replacing the secret, restarting and reconnecting. Losing/replacing the key makes old envelopes unreadable; retry detects this, removes the unusable local credentials and requires reconnect. There is no key-ring/re-encryption migration. Remove the old grant manually if revocation cannot be confirmed; do not reset the studio database.
- Never log callback query strings, consent URLs, Authorization headers, OAuth request/response bodies or upstream exceptions. Configure hosting/access logs, tracing and analytics to redact/exclude these paths and outbound OAuth requests (library revocation can include a token in its outbound URL). The app sanitizes errors and redirects away from callback parameters; provider logging is still the owner's responsibility.
- The validation upgrade replaces only a constraint in one atomic ALTER. It checks required keys, JSON types, IDs/revisions, canonical timestamps/time ordering, status/cancellation consistency and reminder bounds, explicitly rejecting SQL NULL results. It validates existing rows and takes a table lock; schedule a maintenance window if needed. Invalid legacy rows cause an atomic failure, not silent deletion/reset. Inspect/repair affected records with a backup and owner review before rerunning. Historical initial DDL is retained; the effective constraint after all migrations matches the Drizzle schema.

## Verification boundary and owner smoke checklist

Local coverage includes real AES-GCM, PGlite SQL/migration/CAS/leases, Better Auth sessions, strict routes, actual official OAuth library calls with an injected transport, and controlled Google failures/races. Focused failure-path browser tests use **intercepted HTTP fixtures**; separate daily-workflow tests save/reload/reschedule/cancel explicitly synthetic shoots through real local demo HTTP/storage. Neither contacts Google. See [the Task 2 plan](superpowers/plans/2026-10-01-lavender-redesign.md#task-2-execution--2026-10-01) and [verification results](VERIFICATION.md).

**Not run:** live Google consent, real Google event creation/update/deletion, real revocation, notifications on a device, hosted Neon/Netlify deployment or migration. No credentials were requested, no real calendar was connected, no user data was reset. The provider's function duration/timeout configuration must be checked on deployment; the route's `maxDuration = 180` is not a guarantee from the hosting plan. A provider timeout still leaves the durable local save recoverable via retry.

Owner-only smoke checks before relying on the feature:

- [ ] Confirm exact HTTPS redirect/cookie and successful consent; retry a saved shoot and verify one private primary-calendar event and reminder values.
- [ ] Reschedule and retry without duplicates; confirm cancellation affects only that event; inspect remote changes after a simulated provider/network timeout.
- [ ] Verify notifications on the intended device using a future disposable event; do not infer delivery merely from a synced badge.
- [ ] Disconnect and confirm local removal; verify Google grant revocation and that existing events remain. Check setup-loss/key-loss recovery on a separate test deployment.
- [ ] Validate hosted migration, duration limits, outbound TLS/network access, log redaction, rate limits, backups and restore procedures.

Google references: [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [web-server OAuth and exact redirects](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh-token expiration/testing](https://developers.google.com/identity/protocols/oauth2#expiration).