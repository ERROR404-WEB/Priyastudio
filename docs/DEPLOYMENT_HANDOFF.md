# Hey Priya Studio — Deployment & Change Handoff

> **Audience:** an AI assistant (or developer) continuing this project on the owner's **personal laptop**.
> Read this whole file before acting. It describes the current state, the exact deployment steps,
> the safety rules, and how the codebase is organised for future changes.
>
> Last updated: 2026-10-02.

---

## 0. Rules for the assistant (read first)

1. **Never ask the owner to paste secrets into chat.** This includes `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   passwords, Google client secret and the Google encryption key. Tell the owner where to put them
   (`.env` locally, Netlify environment settings in production) and verify only with pass/fail checks
   that never print values.
2. **Never commit `.env`** or anything in `.data/`. Both are already in [.gitignore](../.gitignore); confirm with
   a status check before every commit.
3. **The database in `.env` is the real production database** (Neon). It already contains the owner's real
   collaboration and payment history (see §2). Do **not** reset, drop, re-migrate destructively, or run
   browser tests against it. Back it up before any risky change.
4. **Never disable TLS verification** (`NODE_TLS_REJECT_UNAUTHORIZED=0`). If certificates fail, see §11.
5. **This is Next.js 16.3 (App Router, Turbopack).** APIs differ from older versions. Before writing
   Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/` (see [AGENTS.md](../AGENTS.md)).
6. **Ignore the `.github/` folder.** It contains instruction/skill files and hooks copied from an unrelated
   Python/FastAPI project ("Z-CIP backend"). None of those rules apply to this Next.js app. It is safe for
   the owner to delete `.github/` before publishing the repository.
7. Money is stored as **integer paise** (₹1 = 100). Never use floating-point rupees in domain code.
8. Prefer small, verified changes. After any code change run: `npm run typecheck`, `npm run lint`,
   `npm test`, and (for UI work) the relevant Playwright spec against a **demo-mode** server (§10.4).

---

## 1. What this project is

A personal creator studio for Priya (Instagram content creator, Hyderabad):

- **Public portfolio** at `/`: editorial, animated, light/dark theme. Shows only collaborations the owner
  explicitly publishes. **One card per brand**; clicking a brand opens a dialog listing all its reels.
- **Private studio** at `/studio` (login at unlisted `/login`, single admin, phone number + password):
  brands, collaborations (7 production stages), payments ledger, invoices (INR, PDF), proposals/rate
  cards with share links, review invitations, shoot calendar with optional Google Calendar sync,
  dashboard, settings, JSON export.

### Stack (pinned versions, see [package.json](../package.json))

| Area | Choice |
|---|---|
| Framework | Next.js 16.3.8 (App Router, Turbopack), React 19.3, TypeScript 6 |
| Styling | Plain CSS files with semantic CSS variables ([globals.css](../src/app/globals.css), [portfolio.css](../src/components/portfolio.css), [studio.css](../src/components/studio/studio.css)); Tailwind 4 is installed but barely used |
| Database | Neon PostgreSQL via `@neondatabase/serverless` (HTTP) + Drizzle ORM 0.45 |
| Auth | better-auth 1.7.6 with `username` plugin (username = E.164 phone) |
| Media | Netlify Blobs store `studio-public-media` in production; `.data/media` in local demo |
| Motion | Lenis 1.3.26 (smooth wheel scroll) + custom scroll/pointer effects |
| Dialogs | `@radix-ui/react-dialog` |
| Validation | Zod 4 |
| Tests | Vitest 5 (unit/integration, PGlite real Postgres), Playwright 1.63 (Chromium) |
| Hosting target | Netlify (free tier) + Neon (free tier) |
| Node | 22.12+ LTS (Netlify builds with Node 22 per [netlify.toml](../netlify.toml)); Node 24 also works |

---

## 2. Current state (as of 2026-10-02)

| Item | Status |
|---|---|
| Neon project | Created ("Priya's Studio", region **AWS US East 2 / Ohio**), Postgres only. Neon Auth / storage / functions **off** |
| Migrations | Applied (`npm run db:migrate`): studio tables + 3 calendar tables |
| Admin account | Created via `npm run admin:create`. `ADMIN_USER_ID` saved in `.env`. Email corrected once directly in DB |
| Password policy | Minimum lowered from 12 to **8** characters (owner request) |
| Imported history | **83 brands, 93 collaborations, ₹1,58,200 received**. All **private** (unpublished), stage `posted`, no photos, no reel links |
| Payment dates | **Placeholders**: 1 Jun / 1 Jul / 1 Aug 2026 (real dates unknown). Method "Other", reference "Imported from payment notes; exact date unknown" |
| Categories | Guessed per brand (Food, Cafés, Entertainment, Retail, Promotions, Wellness, Lifestyle, Travel, Beauty, Events, Fashion, Other). Owner may adjust |
| Intentionally NOT imported | Mozz Pizza, Lolly Waffle, Immersive Yoga (shoot done, not posted). Add later via the studio when posted |
| Barter collabs | Ukusa, Privesh Bakery, Mythus Brewery, Game Palxitao Mall (no payment recorded) |
| Google Cloud | Project + Calendar API + OAuth **Web** client created; redirect `http://localhost:3000/api/calendar/callback` registered; owner added as test user. **Connection never completed** (work-laptop proxy blocked it, see §11). Google env vars are in `.env` |
| Version control | **Not a git repository yet** |
| Deployment | **Not deployed** |

---

## 3. Moving the project to the personal laptop

1. Copy the project folder **excluding**: `node_modules/`, `.next/`, `.data/`, `test-results/`,
   `playwright-report/`, `tsconfig.tsbuildinfo`. (`.data/` only holds local demo data; production data is in Neon.)
2. Transfer `.env` **separately and privately** (USB drive or a password manager secure note). Never by
   email/chat. Place it in the project root on the new laptop.
3. Install **Node.js 22 LTS** (or 24 LTS) and Git.
4. In the project folder:
   ```bash
   npm ci
   npx playwright install chromium   # only needed for browser tests
   ```
5. Verify the codebase:
   ```bash
   npm run typecheck
   npm run lint
   npm test          # ~270 unit/integration tests, no network/database needed
   npm run build     # production build; needs no secrets
   ```
6. Optional local run against the real database: `npm run dev`, open <http://localhost:3000/login>, sign in
   with the phone number (`+91…` or `91…`) and password. Studio → Payments should show ₹1,58,200.
   - **Photo uploads do not work locally in this mode**: production uploads require Netlify Blobs, which
     only exist on Netlify. Upload photos on the deployed site.

### `.env` keys expected (values never shared)

| Key | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Neon connection string (`postgresql://…?sslmode=require`). Setting it switches the app from demo mode to real mode |
| `BETTER_AUTH_SECRET` | Yes | Random, ≥ 32 chars. Must stay the same across deploys or all sessions are invalidated |
| `BETTER_AUTH_URL` | Yes | Exact origin. Locally `http://localhost:3000`; in production the exact `https://…` site URL, no trailing slash |
| `ADMIN_USER_ID` | Yes | ID printed by `npm run admin:create` |
| `GOOGLE_CALENDAR_CLIENT_ID` | Optional | Google OAuth Web client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Optional | Matching secret |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Optional | 32 random bytes, **standard padded base64** (44 chars ending `=`). Keep a backup copy; losing it means reconnecting Google |
| `ADMIN_PHONE` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | No | One-time bootstrap only. **Should already be deleted** from `.env`; never set in Netlify |

Never use a `NEXT_PUBLIC_` prefix for any of these.

---

## 4. Put the code in a private GitHub repository

The owner does this step personally (the assistant should not run history-changing version-control commands):

1. Initialise a Git repository in the project folder.
2. Stage all files, then **check the status output**: it must NOT list `.env`, `.data/`, `node_modules/` or `.next/`.
3. Make the initial commit.
4. Create a **private** repository on GitHub and push the commit to it (GitHub Desktop or the VS Code
   Source Control panel are the simplest ways).

Optionally delete the unrelated `.github/` folder first (rule 6).

---

## 5. Deploy to Netlify

1. Netlify → **Add new site → Import an existing project → GitHub** → choose the private repo.
2. Build settings are read from [netlify.toml](../netlify.toml): command `npm run build`, publish `.next`,
   Node 22. Netlify installs its Next.js runtime automatically. Do not change these.
3. **Before the first real use**, pick the final site name (Site configuration → Change site name),
   e.g. `heypriya.netlify.app`. Changing the domain later requires updating `BETTER_AUTH_URL` and the Google
   redirect URI.
4. Site configuration → **Environment variables** → add (mark secret where offered):
   - `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_USER_ID` — same values as `.env`
   - `BETTER_AUTH_URL` = `https://<site-name>.netlify.app` (exact, no trailing slash)
   - `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_ENCRYPTION_KEY` (same as `.env`)
   - Do **not** add `ADMIN_PHONE/EMAIL/PASSWORD`.
5. Trigger a deploy (Deploys → Trigger deploy). Wait for "Published".
6. Netlify Blobs needs no setup; the store is created on first upload.

### Post-deploy smoke test (do all of these)

- [ ] `/` loads; brand section shows no brands yet (everything is private) — expected.
- [ ] `/studio` without login → redirected/denied. `/login` works with phone + password.
- [ ] Studio Home and Payments show **₹1,58,200** received; Brands shows **83**; Collaborations **93**.
- [ ] Upload one test photo on a collaboration → it displays (confirms Netlify Blobs).
- [ ] Publish one collaboration with an Instagram reel link → its brand card appears on `/`, the dialog lists the reel.
- [ ] Download a PDF from a draft invoice (Settings → issuer/payment details must be filled first).
- [ ] Log out, log in again. Check cookies are `Secure`/`HttpOnly` (browser devtools).
- [ ] Set Netlify and Neon **usage alerts**.

---

## 6. Google Calendar (finish on the personal laptop / live site)

Full reference: [docs/GOOGLE_CALENDAR.md](GOOGLE_CALENDAR.md).

1. Google Cloud Console → same project → Google Auth Platform → **Clients** → the Web client →
   add authorized redirect URI: `https://<site-name>.netlify.app/api/calendar/callback` (keep the localhost one for local testing).
2. Ensure the three `GOOGLE_CALENDAR_*` variables are set in Netlify (step 5.4) and redeploy.
3. Live site → Studio → **Shoot calendar → Connect Google Calendar** → choose the account → on the consent
   screen **tick the calendar permission checkbox** → Continue past "Google hasn't verified this app".
4. Plan a test shoot a few days ahead → confirm it appears in Google Calendar with reminders → reschedule →
   cancel.
5. **Testing-mode limitation:** Google expires refresh tokens after **7 days** while the OAuth app is in
   "Testing". To avoid weekly reconnects, Google Auth Platform → Audience → **Publish app** (a personal,
   unverified app still works; the warning screen remains). Verify Google's current policy.
6. Sync is one-way (studio → Google). Edits made directly in Google Calendar are not read back.

If connection fails it redirects to `/studio/calendar?connection=failed` with no details (by design).
Causes, in order of likelihood: permission checkbox not ticked; redirect URI mismatch with `BETTER_AUTH_URL`;
wrong client secret; TLS interception on the network (§11); consent took > 10 minutes.

---

## 7. Owner's day-to-day workflow (for context when making changes)

- **New deal:** Collaborations → New collaboration, or Shoot calendar → "+ New collaboration". Type the
  brand name; a new brand is created automatically. If the name resembles an existing brand (typo, half
  name, different spacing, "HYD"/"Café" suffix, abbreviation), the form asks **"Is this the same brand?"** and
  blocks saving until answered.
- **Publishing:** edit a collaboration → add Instagram reel URL (`https://www.instagram.com/reel/…` or `/p/…`)
  → optional cover photo → tick "Show on my public portfolio". A brand appears on the portfolio once at
  least one of its collaborations is published.
- **Payments:** Payments → Record payment against a collaboration (direct) or an issued invoice.

---

## 8. Known gaps / backlog (good next tasks)

1. **No brand edit/rename/merge** in the UI (there is no `brand.update` command). Two renames were applied
   directly during import. Implement `brand.update` (and possibly merge: move collaborations, delete brand)
   in [types.ts](../src/lib/types.ts) + [domain.ts](../src/lib/domain.ts) + [brands.tsx](../src/components/studio/brands.tsx).
2. **Placeholder payment dates** for imported history; owner may want an edit-payment-date flow (currently only reversal exists).
3. **Bulk publish / reel-link entry** for many collaborations at once would save the owner time (93 to fill).
4. Imported titles are generic (e.g. "Kyma collaboration"); owner will edit them.
5. No password change/reset UI and no MFA (single admin; recovery is a manual DB procedure).
6. Netlify function time limits: calendar sync route declares `maxDuration = 180`, but the free plan's
   actual limit is lower. Shoots are saved before Google sync, so a timeout leaves a retryable "pending" sync.
7. The public portfolio requires at least one published collaboration to show any brand cards.

---

## 9. Codebase map (for making changes)

```
src/
  app/                    Next.js routes. / (portfolio), /login, /studio/*, /p/[token], /review/[token]
    api/                  Route handlers: auth, studio (commands), public (portfolio JSON), calendar, media, upload
  components/
    portfolio.tsx         Public portfolio (brand grouping, brand dialog, filters, brand wall)
    portfolio-motion.tsx  Lenis smooth scroll, scroll/pointer effects, reveals, magnetic buttons
    portfolio.css         Portfolio styles (+ reduced-motion rules)
    studio/               Private studio screens; forms.tsx has BrandPicker + SimilarBrandNotice
    ui/studio-primitives.tsx  Shared Field, Modal, buttons, useTask
  lib/
    types.ts              Data model + Command union (single source of truth)
    domain.ts             Zod schemas + applyCommand (pure business rules, money in paise) + publicPortfolio allowlist
    brand-match.ts        Fuzzy brand similarity (typos, half names, acronyms)
    calendar.ts           Shoot parsing/time zone helpers
    seed.ts               Demo data (local demo only)
  server/
    config.ts             Demo vs real mode (demo = no DATABASE_URL and not production)
    auth.ts               better-auth setup, requireAdmin, password length constants
    bootstrap.ts          One-time admin creation
    persistence.ts        mutateStore: load → applyCommand → compare-and-swap (optimistic concurrency)
    postgres-store.ts     Studio state stored as ONE versioned JSONB row
    media.ts              Image validation + Netlify Blobs / local storage
    calendar/             Google OAuth, encryption, sync, leases
drizzle/                  SQL migrations (idempotent); applied by scripts/migrate.ts
scripts/                  migrate.ts, create-admin.ts
e2e/                      Playwright specs (run against a DEMO server only)
docs/                     GOOGLE_CALENDAR.md, VERIFICATION.md, ASSETS.md, this file
```

### Key patterns

- **All studio writes are commands.** Add a variant to the `Command` union in `types.ts`, a Zod schema and a
  `case` in `applyCommand` in `domain.ts`, then call `mutate(command)` from the UI (`useStudio()` in
  [store.tsx](../src/components/studio/store.tsx)). The server re-validates everything.
- **Public data goes through an allowlist** (`publicPortfolio` in `domain.ts`). Never expose payments,
  contacts or unpublished items publicly.
- **Every private API route** must call `requireAdmin(request)`.
- **Styles** use semantic variables (`--primary`, `--surface`, `--muted`, …) defined for light and dark in
  `globals.css`. Do not hard-code colours. Respect `prefers-reduced-motion`.
- **Accessibility:** 44px touch targets, visible focus, labelled controls; tests check some of this.

---

## 10. Testing

| Command | What |
|---|---|
| `npm test` | Vitest: domain, money, persistence, real PGlite Postgres, auth, calendar, brand matching |
| `npm run typecheck` / `npm run lint` | Strict TS / ESLint |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright (Chromium) against `http://localhost:3000` |

### 10.4 Running browser tests safely

E2E tests expect a **demo-mode** server on port 3000 and some (e.g. `e2e/studio.spec.ts`) **write sample data**.
They refuse to mutate a non-demo server, but never point them at production. To run them while `.env` has a
real `DATABASE_URL`, start a separate demo server whose blank variable overrides `.env`:

```powershell
$env:DATABASE_URL = ' '; npx next dev --hostname 127.0.0.1 --port 3000
```
```bash
DATABASE_URL=' ' npx next dev --hostname 127.0.0.1 --port 3000
```
Then in another terminal: `npx playwright test e2e/<spec>.ts`. Stop the demo server afterwards.
`e2e/calendar.spec.ts` mocks all API calls and never changes data.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm run admin:create` → "Admin bootstrap failed" | An admin already exists (never overwritten), or phone not E.164 (`+91XXXXXXXXXX`), or password < 8 chars, or `.env` not saved |
| `self-signed certificate in certificate chain` | Corporate TLS inspection (happened on the Zoetis work laptop via Netskope). Use `NODE_USE_SYSTEM_CA=1` (or `NODE_OPTIONS=--use-system-ca`). Never disable verification. Should not occur on a personal network |
| API returns 503 in production | A required env var is missing/invalid (`BETTER_AUTH_SECRET` < 32 chars, wrong `BETTER_AUTH_URL`, missing `ADMIN_USER_ID`). There is no demo fallback in production |
| Login works but session immediately lost | `BETTER_AUTH_URL` does not exactly match the site origin (scheme/host) |
| Google "connection was not completed" | See §6 causes list |
| Photo upload fails locally with real DB | Expected — Netlify Blobs only exist on Netlify. Upload on the live site |
| Changed the encryption key | Old Google credentials become unreadable; disconnect/reconnect Google. Studio data is unaffected |

---

## 12. Backups & maintenance

- Neon free tier has a limited restore window; check the current plan. Periodically: Studio → Settings →
  **JSON export** (contains private data — store securely) and/or `pg_dump` with the Neon connection string.
- Media (photos) live in Netlify Blobs and are **not** in the database or the JSON export.
- Schema changes: add a new idempotent SQL file in `drizzle/`, include it in `scripts/migrate.ts`, back up,
  then run `npm run db:migrate` locally against the production `DATABASE_URL`. Migrations never run at build time.
- Keep `BETTER_AUTH_SECRET` and `GOOGLE_CALENDAR_ENCRYPTION_KEY` stable and backed up in a password manager.
- Before upgrading dependencies, check the registry for current stable versions and run `npm audit`.

Further reference: [README.md](../README.md), [src/server/README.md](../src/server/README.md),
[docs/GOOGLE_CALENDAR.md](GOOGLE_CALENDAR.md), [docs/VERIFICATION.md](VERIFICATION.md).
