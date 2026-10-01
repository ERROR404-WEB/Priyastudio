# Hey Priya Studio — approved implementation design

The user approved Netlify + Neon, editorial ivory/blush/plum styling, one phone/password admin, public portfolio, scoped brand review links, production tracking, invoices and payment tracking; then explicitly requested design and implementation. This document captures the execution baseline, not a claim of a deployed service.

## Scope and screens
- `/`: public creator portfolio, selected work, categories, published testimonials, Instagram/contact links. No fabricated verified statistics or testimonials.
- `/login`: unlisted single-admin login, phone as username and password; no public signup. Authenticator MFA can be a later enhancement; no SMS dependency.
- `/studio`: dashboard showing receipts, invoiced revenue, unpaid balance, overdue balance, monthly receipts, active work and next deadlines.
- Studio subpages: collaborations, brands, proposals, invoices, payments, portfolio, settings.
- `/p/[token]`: proposal view, comments, date/counter-offer requests, acceptance of a particular version. Counter-offers do not modify original prices. Admin revises/reissues instead.
- `/review/[token]`: campaign-specific testimonial collection, explicit consent; admin moderation before publishing.

## Domain and accounting rules
INR only; money stored as integer paise, never floating point arithmetic. Draft invoices excluded from receivables. Issued invoice line items and bill-to/issuer information are snapshots. Invoice numbers generated server-side. Payments are positive, linked to an issued invoice, date-stamped, reject overpayment/future dates, and idempotent by ID. Receipts are money received, not profit or tax advice. Receipt reversal preserves history and updates derived balances; it never deletes a receipt. Void permitted only if no unreversed receipts. Issued documents cannot be silently edited. Discounts/taxes are out of initial scope; invoice states this is not automatically a GST tax invoice. Status derives from ledger (unpaid/partially paid/paid and overdue separately). Dates use Asia/Kolkata business calendar.

Brand → many collaborations → deliverables. Production stages: yet_to_record, recorded, yet_to_edit, edited, yet_to_post, posted. Publishing is an explicit admin action. Proposal revisions preserve accepted versions. New proposals are drafts, share action issues a version. Public feedback stays private until consent + admin approval. Optional posting date is a proposal, not a committed date until Priya confirms.

## Persistence and authorization
Next.js App Router/TypeScript, Node server endpoints on Netlify; Better Auth with server-managed sessions and a single immutable admin ID. Neon PostgreSQL + Drizzle. A single versioned JSONB studio aggregate is intentional for one creator: updates use compare-and-swap revision checks and retry, audit entries live in the same atomically committed aggregate. Better Auth uses its relational tables. This avoids half-written invoices or payments; replace aggregate with normalized tables if product becomes multi-user/high-volume. API never exposes the private aggregate publicly. Public endpoints return field allowlists only.

Every mutation validates inputs server-side, checks same-origin, then applies authorization. Admin API requires admin ID even if another auth user exists. Share links are 256-bit random bearer secrets, only SHA-256 hashes stored, scope-bound, expiring and revocable. Rotating a link revokes prior links of the same target/scope. GET never writes or accepts proposals. Tokens are excluded from app analytics/logging; share responses use no-store/no-referrer/noindex. Brand mutations cannot issue invoices, edit prices, publish reviews or record receipts. No raw HTML in comments. Uploads validate size and actual JPEG/PNG/WebP signatures; public images and private data are not mixed.

Development without DATABASE_URL uses a prominently labeled local file-backed demo at `.data/studio.json`, synthetic financial examples and no authentication promise. Never enabled in production. Configured DB uses real admin auth even in development. Missing production config fails closed with setup guidance, never a demo admin bypass. No credentials are committed or requested in chat. Local media only allowed in demo; Netlify Blobs in hosted mode. No remote URL fetches based on brand input.

## Visual design
Warm ivory #faf8f5, white cards, plum #633951, blush #f1e2e7, sage #e8eee8; dark text #302a2d. Cormorant Garamond headings and DM Sans body, self-hosted font packages. Lucide SVG icons, restrained floral ornaments, generous whitespace. Editorial asymmetric photography on public site, slim sidebar and rounded cards in studio. Visible focus rings, labeled inputs, 44px touch targets, reduced-motion support, responsive mobile navigation, horizontal overflow contained to labeled data tables/boards.

## Reliability and deployment
Show errors with retry; no optimistic financial writes. Disable pending submits; use same idempotency ID on retry. Stale proposal acceptance rejected. Files and database configured separately, local demo never deployed. Free tier limits documented, auto-wake not guaranteed uptime. No keepalive abuse. Production provider provisioning, database migrations and admin secret setup require the owner's account; code is verified locally without claiming a live Neon/Netlify deployment.

## Verification
Vitest for real reducer, integer calculations, duplicate payment IDs, partial receipts, reversals, drafts/voids, invalid relationships, wrong scopes/expired links, public allowlist. PGlite integration tests exercise PostgreSQL schema and persistence where available. Build, strict TypeScript, lint, npm audit, browser desktop/mobile tests. End-to-end demo: brand → collaboration → invoice → partial/full receipt → reload; proposal → public acceptance; testimonial → consent/moderation; PDF download. Hosted Neon/Blobs/real auth require separate production smoke verification.