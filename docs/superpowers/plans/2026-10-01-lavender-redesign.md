# Lavender Studio Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute in the existing non-Git workspace; never initialize Git or commit. Review each independent task before integration.

**Goal:** Simplify creator workflows and deliver a responsive lavender portfolio with connected shoot reminders.

**Architecture:** Preserve the tested versioned studio aggregate, adding backwards-compatible direct collaboration receipts and a visit stage. Keep calendar schedules/credentials in separate private storage with authenticated endpoints; layer a shared theme and motion system over existing UI.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Drizzle/PostgreSQL, Better Auth, Vitest/PGlite, Playwright.

**Spec:** docs/superpowers/specs/2026-10-01-lavender-redesign.md

## Global constraints

- Integer paise; no double counting, destructive migration, synthetic legal invoices or reset of saved data.
- No invoiced/overdue UI metrics. Existing immutable invoice history preserved.
- No Google token in aggregate/export/log/client. Auth and Origin checks on every private write.
- One-shot commands run sequentially in PowerShell. Tests first, then implementation, then regression checks.
- No Git history changes. No secrets requested in chat. No real Google events in demo.

## Task 1: Payment and visit workflow

Files: src/lib/types.ts, domain.ts, domain.test.ts; src/components/studio/payments.tsx, collaborations.tsx, overview.tsx, invoices.tsx and related tests.

Interfaces: retain existing invoice payment commands. Extend Payment with optional collaborationId for direct receipts (invoiceId empty), Collaboration with optional expectedPayment paise. Export collaboration balance helpers. Extend Dashboard with yetToVisit/yetToPost; preserve old programmatic financial fields for compatibility but remove their UI. PublicPortfolio uses an explicit public collaboration type excluding private money fields.

- [x] Write regression tests using createDemoState/applyCommand: new direct receipt needs no invoice; duplicate receipt ID is idempotent; reversal restores pending; invoice receipts stay counted once; old state without new keys loads; pending cannot fall below received; public projection excludes payment target. Assert seven stages and dashboard visit/post counts.
- [x] Run targeted Vitest and confirm failures are missing behavior, not test typos.
- [x] Implement optional fields and strict schemas, direct receipt branch, balance validation, expectedPayment command and dashboard aggregation. Existing invoice-backed collaborations use invoice balance; reject mixing direct tracking with active invoice-backed accounting to avoid silent double counting.
- [x] Replace payment UI with collaboration selection, amount/date/method and contextual remaining balance. Keep invoice-backed receipt option for existing records. Simplify collaboration forms using details disclosure and plain labels; no amount required at creation.
- [x] Run targeted tests, typecheck and lint. Review calculation/public-projection boundaries.

### Task 1 execution — 2026-10-01

- Verified interrupted state: no `expectedPayment`, `collaboration.payment-plan` or `yet_to_visit` implementation in `src/lib` before this task.
- RED: `npm test -- src/lib/domain.test.ts src/components/studio/payment-workflow.test.ts` — **21 failed, 82 passed**; failures were missing workflow/schema/UI behavior. GREEN: same command — **103 passed, 2 files** (99 domain + 4 server-rendered UI tests).
- Sequential full verification: `npm test` — **136 passed, 9 files**; `npm run typecheck` — **exit 0**; `npm run lint` — **exit 0**, no diagnostics.
- Interfaces: `Payment.collaborationId?` with `invoiceId: ''` for direct receipts; `Collaboration.expectedPayment?`; command `{ type: 'collaboration.payment-plan', id, pending }` (integer paise), computing received + pending; `CollaborationBalance` and `collaborationBalance(collaboration, invoices, payments)`; `collaborationUsesDirectTracking(collaboration, payments)`; dashboard `yetToVisit`/`yetToPost`; explicitly allowlisted `PublicCollaboration`.
- Reviewed boundaries: unknown target/pending is `null`, never implicitly paid; issued invoices (including fully paid ones) cannot mix with direct targets or active direct receipts. Drafts and reversed/void history do not double count. Invoice payment commands, snapshots, reversal/replay behavior and programmatic financial fields remain compatible. Optional posting deadlines use `''`; publication stays explicit. Public projection does not expose financial fields.
- UI reuses existing primitives/classes; invoice receipt selection remains available. No theme/global CSS/portfolio/calendar edits, Git operations, e2e/build runs or local data reset. `WorkImage` and `RevenueChart` exports preserved. Browser interaction/visual verification remains for later tasks.

## Task 2: Shoot calendar and Google connection

Files: new src/lib/calendar.ts and tests; src/server/calendar/* modules/tests; private src/app/api/calendar/* endpoints; src/components/studio/calendar.tsx and /studio/calendar page; src/server/schema.ts, migration script/SQL, .env.example and docs/GOOGLE_CALENDAR.md.

Interfaces: private GET /api/calendar returns configured/connected/demo connection flags and shoots; POST actions save/cancel/retry/disconnect. Schedule has ID, collaborationId, title, startsAt, endsAt, timeZone='Asia/Kolkata', location, reminder minutes, revision and pending/synced/error/cancelled status. Export UpcomingShoots for Home. OAuth connect/callback use authenticated server-only flow.

- [x] Write tests for valid India time conversion, start before end, reminders [1440,60], private payload, encryption roundtrip/tampering, expiring single-use browser-bound state, stable event ID, Google failures and reschedule/cancellation retry behavior.
- [x] Run failing tests; implement repository with PostgreSQL and separate local-demo file storage, atomic mutation/locking semantics, schema migration and secret encryption using authenticated encryption.
- [x] Implement OAuth using an official Google auth package, server-only token exchange/refresh/revocation. Check current package stable release before install. Never expose upstream response payloads or token-bearing URLs. **Finishing-pass qualification:** package was already installed; registry rechecked as 11.1.0, no install history claimed. Outbound revocation URL logging requires operator redaction (see guide).
- [x] Implement a synchronizer that creates/updates/deletes only app-owned events, preserves retriable failures and avoids stale overwrites. Add owner-auth/Origin/body/rate-limit protected routes. Demo sync is explicitly unavailable.
- [x] Build calendar list/planning form with connect/setup status, separate save/sync messages, retry/cancel/disconnect confirmations and upcoming summary. Google reminders delivered by Google, not an app background timer. `UpcomingShoots` exported; mounting it/navigation is Task 3.
- [x] Run unit/integration tests and document exact owner setup plus unverified live integration boundary.

### Task 2 execution — 2026-10-01

Continued the existing subsystem; no replacement implementation. Read the complete calendar modules/tests, lib contract, routes, UI, schema/migrations and runtime/auth boundaries. Applied systematic debugging and regression-first fixes. No Git commands, cloud setup, user data reset, public UI or global CSS edits.

**Observed RED/GREEN evidence (finishing pass):**

| Check | Observed result |
|---|---|
| Initial `npm test -- src/server/calendar/repository.test.ts src/server/calendar/sync.test.ts` | **19 passed, 2 failed, 2 files**: empty JSON body accepted by CHECK; missing config incorrectly hid stored connection. User separately reported a full-suite 197/2 baseline; that full baseline was not rerun before fixes. |
| Expanded `npm test -- src/server/calendar/repository.test.ts src/server/calendar/sync.test.ts src/server/calendar/ui.test.ts` | **RED: 25 passed, 41 failed, 3 files**. Preserved original assertions; added 38 malformed-JSON cases, a delayed expired-worker refresh failure and setup-loss UI coverage. |
| Setup-loss targeted run | **1 passed, 15 skipped**; stored credentials keep Disconnect visible, formerly synced rows project as pending, local credential removal works without config. |
| `npm test -- src/server/calendar/sync.test.ts` | **16 passed** after atomically lease-fencing credential invalidation. |
| Same expanded three-file command | **GREEN: 66 passed, 3 files** after JSON check and service/repository fixes. |
| `npm test -- src/server/calendar/migration.test.ts` | **2 passed**: valid legacy rows/credentials survive rerun; executed Drizzle check equals effective SQL check via PostgreSQL constraint definitions; invalid legacy data aborts atomically and remains untouched. |
| Calendar browser initial fixture run | **1 passed, 1 failed** due to an exact select-label locator including option text; switched to accessible combobox role/name, then **2 passed**. Not counted as an app defect. |
| Calendar retry-confirmation regression | **RED: 1 passed, 1 failed** because retry sent deletion immediately with no dialog; added existing `ConfirmDialog` flow, then **GREEN: 2 passed**. Also verifies sync-check warns about remote writes and Escape sends no mutation. |
| First full verification after backend fixes | **241 tests passed / 18 files** and lint passed; typecheck found one tuple-inference error in the new parameterized test, fixed with explicit tuple types (no assertion weakening). |
| Final sequential `npm test`; `npm run typecheck`; `npm run lint`; `npm run test:e2e -- e2e/calendar.spec.ts`; `npm audit` | **241 passed / 18 files; exit 0; exit 0; 2 passed; 0 vulnerabilities. All five exit codes 0.** |

**Root causes/fixes:**

- PostgreSQL CHECK treats NULL as accepted. Added [0002_calendar_validation.sql](../../../drizzle/0002_calendar_validation.sql), leaving historical initial DDL intact, and matched [schema.ts](../../../src/server/schema.ts). Explicit false-on-NULL, required/allowlisted keys, JSON types, identity/revision, canonical timestamp ordering, status/cancellation and reminder guards reject malformed direct writes. Migration runner/test fixtures include the upgrade. One atomic constraint replacement, no data rewriting; invalid old data requires explicit owner repair, never reset. Rerun and actual schema parity are tested.
- [service.ts](../../../src/server/calendar/service.ts) now defines `connected` by credential presence independently of setup, while stale/unavailable sync projects as pending. Existing disconnect logic removes local credentials without configuration and returns an unconfirmed-revocation notice.
- Review found a third race: expired worker's late `invalid_grant` could clear the replacement worker's credentials because epoch alone stayed equal. [repository.ts](../../../src/server/calendar/repository.ts) and [credentials.ts](../../../src/server/calendar/credentials.ts) now require the current valid lease in the same SQL mutation for worker invalidation; user disconnect still fences immediately without needing that lease.
- [calendar.tsx](../../../src/components/studio/calendar.tsx) now confirms both sync retry/check and deletion retry, clearly explaining recreation/write effects. Existing save/lost-response idempotency, reschedule focus, cancellation and disconnect behavior are exercised in [e2e/calendar.spec.ts](../../../e2e/calendar.spec.ts). Browser APIs are intercepted, no local saved data changed. Widths **320/390/768/1024/1440** passed overflow checks including maximum-length text. Existing styling only; no theme work.

**Contracts/handoff:**

- `GET /api/calendar` → `CalendarView`; `POST /api/calendar` → save/cancel/retry/disconnect actions (revision CAS for saves/cancels; disconnect adds `notice`). `POST /api/calendar/connect` → official consent URL + binding cookie. `GET /api/calendar/callback` → authenticated, single-use browser-bound/PKCE callback and clean 303 redirect. See [Google guide](../../GOOGLE_CALENDAR.md) for exact fields, errors, caps and limits.
- Optional runtime variables: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_ENCRYPTION_KEY` (32 random bytes, standard base64); callback derives from existing `BETTER_AUTH_URL`. Core database/auth/admin configuration remains mandatory for real connection. Added variables to [.env.example](../../../.env.example); updated [README](../../../README.md) and [verification notes](../../VERIFICATION.md).
- Reviewed/tested: OAuth owner/browser binding, one-use/expiry, required offline tokens/scopes; encrypted secrets excluded from aggregate/export/public views; own-event markers/guests/ETags, lost creates, reschedules, tombstones, disconnect/in-flight/expired workers; optional config and demo fail-closed behavior. Review was an in-session source/test review, **not** an independent subagent review.

**Honest remaining boundaries:** no live Google consent/event/reminder/revocation, hosted Neon/Netlify migration/deployment, production build or full unrelated browser suite run in this finishing pass. Browser fixture tests are not live integration. Google/account/device configuration and hosted smoke checklist remain owner actions. No webhook/background retry worker/automatic backfill; a request blocked by another shoot's lease stays pending for retry. Already-sent IO can finish after disconnect; external atomicity/delivery is not guaranteed. Hosting duration/log-redaction and backups need owner verification. Home navigation/summary mounting and theme/public redesign remain **Task 3**; integrated build/full e2e remain **Task 4**.

## Task 3: Lavender themes and interface

Files: src/components/theme-provider.tsx, theme-toggle.tsx; root layout/globals.css; src/components/portfolio.tsx; studio shell/overview/studio.css; public-share/login styles as needed; e2e/redesign.spec.ts.

Interfaces: ThemeToggle uses shared root data-theme preference, system light/dark with persisted override. Every surface uses semantic CSS variables; theme is initialized before paint with a small guarded script. CSS reduced-motion disables nonessential transforms/transitions.

- [x] Add browser tests for theme toggling/persistence, four dashboard labels, no invoice/overdue stats, primary navigation, responsive public/studio layouts and reduced motion. Initial agent implementation returned no report, so its initial RED run is not claimed; subsequent integrated failures and fixes were observed directly.
- [x] Implement shared theme tokens and accessible toggle, no flash/hydration mismatch. Convert hardcoded component colors to tokens rather than using invert filters.
- [x] Simplify navigation to four primary destinations plus More; preserve deep links and mobile drawer keyboard behavior. Home exposes Add collaboration, Plan shoot and Record payment. Add upcoming shoots.
- [x] Redesign portfolio with responsive photography, editorial type, restrained scroll reveals, hover/focus effects and accessible work filters. Preserve public projection and consent boundary.
- [x] Run browser tests and inspect desktop/mobile screenshots in both themes. Fix individual overflow sources rather than hiding body overflow.

### Task 3 execution

- User additionally requested stronger public wow factor: 3D parallax, cursor-following accents, cute professional Pinterest/Instagram aesthetic. Approved editorial-scrapbook direction with discretion after bounded design proposal.
- Implemented native-scroll layered photo depth, pointer tilt and non-intercepting floral glow; event-driven rAF without a continuous render loop. Desktop fine pointer only; touch and reduced motion get a static composition. Existing photography/public allowlists retained.
- Shared system/persisted light-dark theme covers public, invitations, login, studio and portals. Simple DM Sans admin versus editorial Cormorant public typography. Four primary links plus More; private upcoming shoots mounted on Home.
- Reminder presets now say `1 day and 1 hour before`, with advanced custom minutes optional. Observed RED: calendar UI test 1 failed/6 passed; final suite green. Pending/demo reminder wording does not claim active delivery.
- First full visual integration: 34/36 browser checks passed; two historical tests had obsolete labels/hidden optional-form locators. Corrected locators with business assertions retained; historical suite4/4 passed. Three new real-demo daily workflow tests passed independently.
- Screenshot review found `momentsand` on narrow public layout; targeted test failed, replaced forced break with naturally wrapping text.

## Task 4: Integrated verification

- [x] Update existing e2e labels only where approved UI changed; preserve accounting/PDF/share/review security assertions.
- [x] Run npm test, npm run typecheck, npm run lint, npm run test:e2e, npm run build and npm audit sequentially.
- [x] Read-only review of new auth/calendar/financial boundaries and visual responsive evidence; resolve blocking findings.
- [x] Update README/VERIFICATION with exact observed test results and remaining Google owner setup. No claim of live reminders unless verified with consent.

### Task 4 execution

- Integrated checks: 242 unit/integration tests / 18 files; 39 Chromium browser tests; typecheck/lint/build exit0; npm audit0. No live Google/browser-engine claims beyond this evidence.
- Verified production missing-config studio/calendar503 and clean callback-failure303 on temporary port3100; public200 with no synthetic data. Stopped only the owned temporary production server; dev preview remains running.
- Reviewed actual screenshots; no document overflow at tested widths. Editor diagnostics clean.
- Independent backend review found no actionable blockers. Ruling: rejected visual review's proposed deferred theme script/removing root hydration suppression because it would reintroduce flash; suppression is one level for intended root attribute, not the whole subtree. Storage is already caught, snapshots always return a valid theme, initial fetch abort is checked, motion cleanup is synchronous and early reduced-motion return prevents listeners. Public profile parse receives explicitly enumerated fields. No factual basis for reported critical races or unrun Safari/Edge coverage; no speculative changes applied.

## Decisions and progress

- Approved automatic sync rather than a manual calendar-link substitute.
- Ruling: optional direct payment tracking is separate from issued-invoice accounting, because forcing an invoice contradicts requested simplicity. Existing invoice workflows remain available.
- Ruling: calendar data is private and separate from the public studio aggregate, minimizing accidental credential/location exposure and isolating external IO.
- Ruling: use existing non-Git workspace; worktrees/commits are forbidden by repository instructions.
- Design and plan self-review: all requested dashboard, visit, reminder, theme, animation and responsive requirements implemented and locally verified. Live calendar setup/verification and hosted deployment are explicitly not claimed.