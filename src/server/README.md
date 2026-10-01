# Backend handoff / owner setup

## Configuration and setup (not deployed)

Runtime secrets are server-only: `DATABASE_URL` (Neon PostgreSQL URL),
`BETTER_AUTH_SECRET` (cryptographically random, at least 32 characters),
`BETTER_AUTH_URL` (the exact site origin; HTTPS in production), and `ADMIN_USER_ID`.
Do not prefix any with `NEXT_PUBLIC_`, print them, or commit a filled environment file.
The root `.env.example` lists the names without credentials.

1. Provision a Neon database and supply its connection URL through the environment.
2. Run `npm run db:migrate`. This executes `drizzle/0000_studio.sql` against **real Neon**
   in a single transaction. Initial creation is additive and rerunnable; it does not
   drop/reset existing tables. Future schema changes need explicit reviewed migrations;
   `CREATE TABLE IF NOT EXISTS` is not an existing-schema upgrade mechanism. Use this
   script, not an unreviewed `drizzle-kit push` or a regenerated initial migration.
3. Set the one-time environment values `ADMIN_PHONE` (E.164, including `+` and country
   code), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (8–128 characters). Run `npm run admin:create`.
   Only `ADMIN_USER_ID=<id>` is printed. A singleton claim plus user/account creation is
   one SQL statement; re-running never overwrites credentials or creates another admin.
4. Set `ADMIN_USER_ID` to the printed ID and configure the other runtime values. Remove
   `ADMIN_PHONE`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from the environment after bootstrap.
   Login accepts E.164 or the same country-code digits without `+`; it never guesses a
   country code. No SMS, signup, username availability, username changes, or public
   password reset is enabled. Credential recovery/rotation is an owner-operated database
   procedure, not a shipped public endpoint. MFA is not implemented.
5. On Netlify, configure runtime values in site environment settings. The current Next.js
   runtime adapter is auto-detected; production imagery uses Netlify Blobs' site-provided
   identity and a strongly consistent named store (`studio-public-media`). No local disk
   fallback is allowed with a configured database. Non-Netlify hosting needs an explicit
   media adapter/configuration change; a missing Blobs context returns a sanitized 503.
6. Give previews their own database, exact origin, secret, admin, and preferably their own
   Netlify site. Do not wildcard trusted origins. Named Blob stores are site-wide, so
   preview deployments on the same site may share media. No migration or bootstrap runs
   automatically during build, deploy, or a web request.

With no `DATABASE_URL` outside production, localhost uses an **unauthenticated synthetic
demo** at `.data/studio.json`; writes are serialized per process and replaced through
same-directory temporary-file rename. Do not use multiple Node processes against this
demo file or treat it as production persistence. Corrupt/unreadable storage is an error,
not permission to reset the state. Demo HTTP access is restricted to localhost/loopback.
Production always fails closed (503) on missing runtime configuration. Auth and database
initialization are lazy so module collection/build does not require secrets.

## Interface and security

- `src/server/store.ts`: async `getState()`, `mutate(command, actor)`, `isDemo()`.
  `mutate` also accepts a pure `(state, now) => command` callback. Callbacks are rerun
  after conflicts; they must not perform IO. State, revision, and domain audit entries
  are one atomic PostgreSQL compare-and-swap update, with at most 12 attempts (409 on
  exhaustion). The JSONB row is deliberate for a small, single-admin workspace.
- `src/server/auth.ts`: lazy `getAuth()` and `requireAdmin(request)`. Every private
  endpoint checks the immutable configured admin ID, not merely whether a session exists.
  Cookie caching is disabled, sessions expire after 12 hours, and production cookies
  are secure/HttpOnly. The auth route allowlists only username login, session retrieval,
  and sign-out. Better Auth independently disables sensitive paths and refuses to create
  sessions for a non-allowlisted user.
- Every write requires an exact `Origin` match against both the request URL and the
  configured site origin. No CORS wildcard or proxy-header trust is used. CLI requests
  to mutations need the correct Origin header too. JSON bodies have actual streamed-byte
  limits, not just Content-Length checks; validation is strict and errors are `{error}`.
- `GET /api/studio` → `{state, demo}`; `POST /api/studio` with `{command}` → `{state}`.
  Client `share.create`, `proposal.comment`, `proposal.accept`, and `testimonial.create`
  commands are rejected. `share.revoke` remains an admin command.
- `POST /api/studio/share` with `{targetId, scope: 'proposal' | 'review'}` →
  `{state, shareUrl}`. URLs are complete `/p/[token]` or `/review/[token]` URLs. Tokens
  contain 256 random bits; only SHA-256 is persisted. Rotation revokes earlier links
  for that scope/target. Links last at most 14 days; proposals expire earlier at midnight
  following their validity date in Asia/Kolkata. Tokens are bearer capabilities: anyone
  with the link can view/respond until revoked. Signer names are not identity verification.
- `GET /api/public/portfolio` → `{portfolio, demo}`, using the domain's explicit
  publication/consent allowlist, never the private aggregate.
- `GET /api/public/proposal/[token]` → `{proposal, brandName, creatorName, demo}`.
  POST accepts `{action:'comment', name, text, expectedDate, counterOffer}` or
  `{action:'accept', name, version}` and returns `{ok:true}`. `expectedDate` can be empty;
  `counterOffer` is null or positive integer paise. Scope, revocation, expiry, status, and
  accepted version are rechecked **inside every CAS attempt**, including after conflicts.
- `GET /api/public/review/[token]` → `{collaboration:{id,title,image,reelUrl}, brandName,
  creatorName,demo}`. POST `{name,role,text,consent:true}` → `{ok:true}`. Reviews always
  start unapproved. Names ≤200 chars, text ≤5000 chars, strict fields, no raw comment HTML.
- Share/API responses are `no-store`, `no-referrer`, and `noindex`. The server never logs
  token paths/bodies. **Owner responsibility:** exclude `/p/*`, `/review/*`, and corresponding
  API paths from analytics/error URL capture and configure hosting access-log redaction or
  retention appropriately; provider request logs are outside application control.

## Upload contract — important frontend disclosure

`POST /api/upload` accepts multipart **one `file` only**, at most **4 MiB**, and requires
admin authorization and same-origin. JPEG/PNG/WebP signatures are checked; MIME/extension
claims are not trusted. SVG, PDF, and other signatures are rejected. Returns
`{url:'/api/media/<uuid>'}`. `GET /api/media/[id]` only accepts generated UUID v4 names,
rechecks bytes, emits a correct MIME, `nosniff`, and a sandbox CSP.

**Uploading consciously publishes that image. All uploaded images are anonymously readable,
including previews and images not yet attached to a published campaign. No private uploads,
invoices, identity documents, or confidential campaign files are permitted.** The frontend
must disclose this before upload and use a 4 MiB client limit. This API cannot determine
whether an otherwise valid photo depicts a confidential document. It is not a private
attachment service. Image decoding/re-encoding, EXIF stripping, malware scanning, media
deletion/retention management, and thumbnails are not implemented. Uploaded bytes are
signature-validated, not claimed to be fully decoded or sanitized image pixels.

## Spam, rates, and remaining operational limits

Hosted limits use a PostgreSQL atomic UPSERT with the database clock, shared across all
instances. No IP header is trusted. Login is globally limited to 30 attempts/15 minutes;
admin mutations to 120/minute, link creation to 30/minute, uploads to 20/hour. Public
portfolio/proposal/review reads each have 240/minute limits; media has 600/minute. Proposal
writes are 120/minute globally and 15/10 minutes per share; reviews are 60/minute globally
and 5/hour per share. Persistent aggregate quotas additionally cap each proposal at 25
comments and each campaign at 5 testimonials, even across link rotation. These caps are
checked in the same CAS update as the mutation.

The localhost demo uses in-memory rate counters only (reset on restart, not cross-process).
Production never uses that limiter. Global hosted quotas trade simplicity for availability:
an attacker can consume a quota and cause temporary denial of service, and rejected traffic
still incurs database requests. Configure Netlify firewall/bot controls as an additional
edge layer. No CAPTCHA is supplied. Rate rows for old valid share IDs are not automatically
pruned. Aggregate audit/state growth is unbounded; monitor size and back up Neon. This is
not intended for multi-user/high-volume operation.

The CSP intentionally avoids `script-src`: without per-request nonces a strict policy
would break Next hydration. Object embedding, frames, form destinations, and base URLs
are constrained; this is not claimed to be a complete strict CSP.

## Verification and integration handoff

Owned verification commands: `npx vitest run src/server`, `npm run typecheck`, and
`npx eslint src/server src/app/api scripts next.config.ts drizzle.config.ts`.
Tests use real temporary files, real PGlite PostgreSQL tables/JSONB/UPSERT/CAS, and the
actual Better Auth adapter, password hashing, sessions and username plugin. No mocked
persistence or authentication implementation is used. PGlite does not prove hosted Neon
network/TLS or Netlify runtime identity/Blobs behavior. After provisioning, smoke-test
migration reruns, bootstrap/login, non-admin denial, cookie/security headers, atomic writes,
share revocation, and public uploads on the owner's hosted resources.

Frontend/domain/package files are owned by other workers. In particular, the existing
frontend upload helper initially allowed 5 MiB; align it to 4 MiB, and add the public-upload
disclosure above. The backend accepts country-code phone digits with or without `+`.
No Git changes, deployment, resource provisioning, live Neon migrations, or real credential
creation were performed during implementation.

### Owned file manifest

- Persistence/configuration: `src/server/config.ts`, `src/server/database.ts`,
  `src/server/schema.ts`, `src/server/store.ts`, `src/server/persistence.ts`,
  `src/server/postgres-store.ts`, `src/server/file-store.ts`.
- Security and IO: `src/server/auth.ts`, `src/server/bootstrap.ts`, `src/server/errors.ts`,
  `src/server/http.ts`, `src/server/rate-limit.ts`, `src/server/shares.ts`,
  `src/server/media.ts`, `src/server/migrations.ts`.
- Routes: `src/app/api/auth/[...all]/route.ts`, `src/app/api/studio/route.ts`,
  `src/app/api/studio/share/route.ts`, `src/app/api/public/portfolio/route.ts`,
  `src/app/api/public/proposal/[token]/route.ts`, `src/app/api/public/review/[token]/route.ts`,
  `src/app/api/upload/route.ts`, `src/app/api/media/[id]/route.ts`.
- Tests: `src/server/auth.integration.test.ts`, `src/server/persistence.test.ts`,
  `src/server/routes.test.ts`, `src/server/security.test.ts`, `src/server/shares.test.ts`.
- Setup/deployment configuration: `scripts/create-admin.ts`, `scripts/migrate.ts`,
  `drizzle/0000_studio.sql`, `drizzle.config.ts`, `.env.example`, `netlify.toml`, `next.config.ts`.
- Handoff documentation: `src/server/README.md` (this file).

### Verification observations

Owned backend tests and owned-file ESLint passed. Full `npm run typecheck` was attempted;
at that point it reported an unrelated, not-yet-created frontend `@/components/invoice-pdf`
module from `src/components/studio/invoices.tsx`. A production `npm run build` with the
four backend environment values explicitly cleared was also attempted; it stopped on
that missing PDF module and the not-yet-created `src/components/studio/studio.css`.
Neither file was changed by the backend worker. Production-secret-free module loading
is separately exercised by a test, but a **complete successful application build is not
claimed** from the blocked attempt. Re-run the whole-workspace checks after frontend work
is integrated.