# Hey Priya Studio

A personal creator studio for **Priya · @hey.its_priya_**. An editorial public portfolio on the outside, a private collaboration and money-management workspace behind it.

**Built locally; not deployed to a cloud account.** Production needs the owner's Neon/Netlify configuration and initial admin setup. The local demo requires no accounts and contains **synthetic finances**, not actual brand engagements.

## What’s included

- Lavender editorial portfolio using Priya’s supplied photographs: a brief native-sticky, scroll-driven 3D photo sequence, cursor-following floral glow, tilting work cards and scroll-linked image movement. Scrolling works on phones too, with lighter depth; only reduced-motion preference disables the animated sequence. Cursor effects remain desktop-only. No scroll hijacking or WebGL dependency.
- Shared light/dark themes across portfolio, studio, login and invitations, with system preference, remembered override and smooth color transitions.
- Simple studio navigation: Home, Collaborations, Shoot calendar, Payments and More. Optional details stay out of short everyday forms.
- Unlisted `/login`: one admin, **phone number + password**. No signup, SMS dependency or public admin link in production.
- Brands, contacts, collaboration photos/reels, due dates, grid/list/production board and explicit public/private publication.
- Seven stages: **yet to visit → yet to record → recorded → yet to edit → edited → yet to post → posted**.
- Personalized rate cards with line items, usage/ad rights, commercial terms, validity and delivery timeline. Expiring private links for comments, requested dates, counter-offers and version-specific acceptance.
- Review invitations with explicit publication consent, followed by admin moderation.
- Draft/issued/void INR invoices, server-assigned numbers, preserved billing snapshots and **browser-generated PDF downloads**.
- Payment ledger: direct collaboration receipts without requiring an invoice, existing invoice-backed receipts, duplicate-submission protection, reversals and derived balances.
- Dashboard: **money received**, pending payments, yet-to-visit and yet-to-post counts, six-month receipt chart and upcoming work. Receipts are **not profit**; this is not an expense/tax accounting system.
- Private `/studio/calendar`: shoot planning in Asia/Kolkata, connected Google Calendar sync after owner setup, reschedule/cancel/retry confirmations and explicit saved-versus-synced status. Home shows upcoming shoots. Readable reminder presets default to **1 day and 1 hour before**. Google sends reminders; the app does not run a notification timer. See [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md).
- Persistent PostgreSQL storage in production, an audit trail, public-data allowlists and private JSON export.

## Local preview

Use **Node 22.12+ LTS** (Node 24 LTS also supported) and npm. Run `npm ci`, then `npm run dev`. Open <http://localhost:3000> for the portfolio or <http://localhost:3000/studio> for the studio. A VS Code task named **Hey Priya Studio: local preview** is included and binds only to loopback.

With no `DATABASE_URL`, development uses an **unauthenticated, loopback-only synthetic demo**. Changes survive refresh/restart in [.data/studio.json](.data/studio.json); image uploads are stored separately. These generated files are ignored by source control. Do not enter real bank information or credentials into the demo. Use only one development process against its local file. Keep the dev server on loopback; it is not an Internet hosting option.

When a database is configured, real authentication is required even in development. A failed database never triggers a demo fallback. Production without configuration refuses private/API access with 503; the public introduction can still render without invented portfolio data.

## Free hosting: Netlify + Neon

No separate Render server, SMS provider, payment gateway or paid PDF API is required. Netlify hosts Next.js and public image blobs; Neon provides PostgreSQL with **automatic wake from idle**. Use the provider's included domain to avoid domain fees.

Free tiers have quotas, cold starts and no guaranteed uptime. They can change. Check current [Netlify pricing](https://www.netlify.com/pricing/) and [Neon pricing](https://neon.com/pricing/) before deployment. Initial research found Netlify’s credit-based free allowance and Neon’s 0.5 GB/100 CU-hour free allowance suitable for a small personal studio; neither means unlimited free usage. Set usage alerts, keep photographs compressed and do not enable paid upgrades without reviewing cost.

### Owner setup

1. Create a Neon project and database. Keep the connection URL private, including its TLS settings.
2. Create a Netlify site for this project. The supplied [netlify.toml](netlify.toml) uses `npm run build`, `.next` output and Node 22. Netlify auto-detects its Next.js adapter. No resources are provisioned by this repository.
3. Securely configure the variables listed in [.env.example](.env.example). For local CLI setup, a private `.env` file is supported by dotenv. Do not commit it or send secret values through chat. Next.js reads that file as well.
4. Back up the intended database and run `npm run db:migrate`. The studio/calendar DDL and calendar validation upgrade can be rerun without resetting data. Invalid legacy calendar rows abort the constraint upgrade for owner review. Migrations are **never** run automatically at build/startup; see [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md) for upgrade details.
5. Set the temporary `ADMIN_PHONE` (E.164, e.g. country code plus number), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (8–128 characters) in your private environment. Run `npm run admin:create`. It prints only `ADMIN_USER_ID`; save that as a runtime variable. This is a singleton bootstrap, not a password-reset command.
6. Remove the three temporary bootstrap values. In Netlify set **runtime/server** variables: `DATABASE_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, `BETTER_AUTH_URL` equal to the exact HTTPS site origin, and `ADMIN_USER_ID`. Never prefix them with `NEXT_PUBLIC_`.
7. Deploy, then visit `/login`. Enter the configured phone including its country code and password. Enter legal issuer details and payment instructions in Settings before creating an invoice. Production starts empty; demo brands/payments are **not** imported.
8. Add real brands/collaborations, upload public photos, choose what to publish and verify the public portfolio. Back up the database and media independently.
9. Optionally follow [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md) to enable Google Calendar API, register the exact callback, set the three server-only Google variables, connect and verify a disposable event/reminder. Live Google integration has not been exercised here. Missing Google setup never prevents durable shoot planning.

Use separate credentials/databases for previews. Blob stores are site-scoped; for proper isolation use a separate Netlify preview site. Changing the site domain requires updating `BETTER_AUTH_URL`. No cross-origin wildcard is permitted.

### Before going live

Run a hosted smoke check: migration rerun, singleton admin, login/logout/session expiry, unauthenticated/non-admin denial, save/reload, concurrent receipts, proposal comments/acceptance/revocation, testimonial moderation, image upload/read and PDF download. Verify HTTPS cookies and response headers. Configure usage alerts, hosting log retention and backups. Real Neon network/Netlify identity integration **cannot be proven by local PGlite tests** and has not been exercised here.

## Important boundaries

- **Every uploaded photo is public immediately**, including draft covers. Do not upload invoices, IDs, contracts or confidential campaign material. JPEG/PNG/WebP only, **4 MiB** maximum; file signatures are checked. Strip location/EXIF metadata before uploading. Full re-encoding, malware scanning and media deletion/retention automation are not included.
- Share links are bearer credentials. Anyone with one can respond until it expires or is revoked; a typed acceptance name is **not verified identity or a certified e-signature**. Creating a replacement revokes old links. Tokens are hashed at rest, expire within 14 days (or sooner for proposals), and are never intentionally logged by the application. Exclude share URLs from analytics/error reporting and review hosting access-log retention.
- Invoice values are integer paise. Issued line items, issuer, bill-to and notes cannot be edited. New invoices snapshot payment instructions into notes. Received/balance totals reflect the current ledger at download time. A basic INR invoice is **not automatically a GST tax invoice**. No GST/TDS/discount/refund/expense automation or gateway reconciliation is supplied; record net bank receipts carefully and consult an accountant for tax requirements. PDF core-font output is intended for Latin-script billing text and uses `INR` instead of a rupee glyph.
- No MFA or public password recovery is implemented. Credential recovery is an owner-operated maintenance procedure; store the initial password securely. A login route being unlisted is not its security boundary—server authorization is.
- Production rate limits are database-backed and shared across functions. Global limits may temporarily deny legitimate traffic during abuse; enable provider edge/bot protections. State/audit retention is not automatically pruned.
- The versioned JSONB aggregate is intentional for **one low-volume creator**. Auth users/sessions/rate limits use relational tables. Multi-admin/high-volume growth requires redesign and data migration.
- JSON export includes private billing/contact data and audit history. Store it securely. It is not a one-click backup restore and does not include auth credentials, uploaded media, private calendar shoots or Google credentials. Back up calendar tables independently with the database; Google credentials are encrypted and need the separately protected encryption key.

## Verification and project structure

| Command | Purpose |
|---|---|
| `npm test` | Domain, money, public projection, real-file persistence, real PGlite PostgreSQL and Better Auth integration tests |
| `npm run typecheck` | Strict TypeScript |
| `npm run lint` | ESLint / React / Next checks |
| `npm run build` | Production build; does not require runtime secrets |
| `npm audit` | Known dependency vulnerabilities |
| `npm run test:e2e` | Chromium workflows against the running localhost demo; focused calendar UI cases intercept HTTP without changing demo data |

Install the test browser once using `npx playwright install chromium`. On enterprise Windows networks, Node’s `NODE_USE_SYSTEM_CA=1` can use trusted system certificates; do not disable certificate verification. Browser tests refuse mutation when the server is not explicitly in demo mode. They retain labeled QA records/audit history, reverse/void their receipts/invoices, and unpublish automated testimonials after each run.

- [src/lib/types.ts](src/lib/types.ts): shared data and command contracts.
- [src/lib/domain.ts](src/lib/domain.ts): validated pure business transitions and accounting.
- [src/server/README.md](src/server/README.md): persistence, security, APIs, operational handoff.
- [src/app](src/app): public/studio/share routes and server APIs.
- [src/components/studio](src/components/studio): private workspace screens.
- [src/components/invoice-pdf.tsx](src/components/invoice-pdf.tsx): on-demand local PDF generation.
- [e2e/studio.spec.ts](e2e/studio.spec.ts): real browser acceptance flows.
- [docs/ASSETS.md](docs/ASSETS.md): photograph provenance.
- [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md): optional owner setup, API/env contracts, concurrency/security boundaries and unverified live smoke checklist.
- [docs/VERIFICATION.md](docs/VERIFICATION.md): final local redesign and scroll checks, 242 unit/integration tests and 45 Chromium browser tests; live Google and hosting checks remain owner-only.

Dependencies are pinned with a lockfile. The scoped esbuild override replaces a vulnerable transitive version in drizzle-kit’s legacy loader; keep checking it when upgrading tooling. No git initialization, commits, pushes or live deployments were performed by the implementation agent.