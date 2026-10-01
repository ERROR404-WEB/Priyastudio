# Hey Priya Studio Implementation Plan

> For agentic workers: use subagent-driven-development; no history-changing Git commands. User explicitly requested continuous implementation after approving design.

**Goal:** Deliver a working creator portfolio and persistent collaboration/financial workspace.
**Architecture:** Next.js app with pure tested domain transitions, a versioned PostgreSQL aggregate and Better Auth. Local-only file-backed demo exercises the same transitions.
**Tech Stack:** Next.js, TypeScript, Tailwind, Radix, Neon, Drizzle, Better Auth, Netlify Blobs, React-pdf, Vitest.
**Spec:** ../specs/2026-10-01-hey-priya-studio-design.md

## Global constraints
INR integer paise; production fails closed; no public signup; no client secrets; atomic persisted updates; explicit demo labels; no Git mutation; no external provisioning without owner credentials; issuer/tax details never fabricated.

## Task 1 — domain and financial behavior
Files: `src/lib/types.ts`, `src/lib/domain.ts`, `src/lib/domain.test.ts`, `src/lib/seed.ts`.
Interface: `StudioState`, `Command`, `applyCommand(state, command, actor, now)`, `invoiceTotal`, `invoicePaid`, `invoiceStatus`, `dashboard`, `publicPortfolio`.
- [ ] Write failing behavioral tests: issued invoice total 100000 paise with 25000 receipt yields 75000 outstanding; repeat ID stays one receipt; reversal restores balance; draft/void excluded; overpayment rejected; testimonial consent gates publication.
- [ ] Run `npm test`; confirm missing behavior fails.
- [ ] Implement validators, pure transitions and audit history; seed clearly synthetic demo data.
- [ ] Run tests and TypeScript review.

## Task 2 — persistence, authentication and API
Files: `src/server/**`, `src/app/api/**`, `scripts/**`, `drizzle/**`, `.env.example`, `netlify.toml`, `next.config.ts`.
Consumes domain state/commands; produces `getState`, `mutate`, `requireAdmin`, `isDemo`, public token endpoints and upload endpoint.
- [ ] Add failing tests for hashing/expiry/scope, aggregate revision conflict/reload and public projections.
- [ ] Implement PostgreSQL CAS storage, local demo file storage with serialized atomic writes; Better Auth tables and admin bootstrap with environment-only secrets.
- [ ] Add GET/POST `/api/studio`, POST `/api/upload`, GET image endpoint, `/api/auth/[...all]`, share GET/POST endpoints. Server validates every body and origin.
- [ ] Exercise persistence against real PostgreSQL engine (PGlite); run tests. Document unavailable hosted verification.

## Task 3 — polished client interfaces
Files: `src/app/**` excluding API; `src/components/**`, `src/lib/client.ts`, `public/**`.
Consumes GET `/api/studio` `{state, demo}`, POST `{command}` → `{state, shareUrl?}`; public `/api/public/{proposal|review}/[token]`.
- [ ] Add browser smoke test expectations for route navigation, empty errors, mobile width and financial workflow.
- [ ] Implement portfolio, shell/dashboard, brands/campaign forms, production board, proposals, invoices/receipts, moderation, settings, accessible dialogs.
- [ ] Provide pending/error feedback; all actions wired, no decorative dead buttons. Dashboard values derive only from persisted domain.
- [ ] Verify desktop/mobile and reload persistence in local demo.

## Task 4 — integration, PDFs, release verification
Files: PDF component, README, browser tests; focused fixes in integrated modules.
- [ ] Test PDF from persisted issued invoice; verify snapshot amounts and printable text.
- [ ] Test shared acceptance and moderated testimonial; server rejects incorrect scopes and duplicate financial mutations.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit`.
- [ ] Review security boundaries, fix findings, rerun affected tests. Record actual checks and owner setup requirements in README.

## Execution rulings
- Existing folder contains only editor/GitHub configuration, not a Git repo; work in place without creating worktrees or commits.
- User's instruction to design and implement authorizes executing the approved direction, rather than another design-only approval loop.
- Existing backend Python instructions describe a different project; no Python/Azure modules are created or edited.
- Financial status tracks cash receipts and receivables, not legally recognized income/profit. GST logic deferred until confirmed; basic invoices are supported now.