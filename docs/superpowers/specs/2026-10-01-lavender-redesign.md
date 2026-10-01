# Hey Priya — simpler lavender studio

Approved in conversation: simplified navigation and daily workflows, received/pending money only, visit planning, automatic connected Google Calendar sync, lavender light/dark themes and a cinematic responsive public portfolio.

## Experience

- Main destinations: Home, Collaborations, Shoot calendar, Payments, More. Brands, rate cards, invoices, portfolio controls and settings remain available as secondary tools.
- Home shows Money received, Pending payments, Yet to visit and Yet to post. Plain-language next actions replace poetic instructions. No invoiced or overdue dashboard figures.
- New production stage `yet_to_visit` precedes the existing six stages. Publication stays an independent explicit action.
- New collaborations can record payments without creating invoices. A contextual "Still to receive" control sets the remaining balance; an invoice is never silently generated. Invoice-backed historical balances and receipts retain their existing accounting semantics and are not counted twice.
- Existing records, financial history, audit trails, links and PDF generation remain intact. No destructive reset or migration.
- Visit/shoot planning is optional, distinct from posting deadlines. Date, start/end time and location, Asia/Kolkata timezone explicitly shown. Default Google reminders: one day and one hour before.

## Calendar boundary

- OAuth connection is owner-only, server-side, least-privilege. Exact redirect URI, expiring single-use state tied to the authenticated browser, PKCE, offline access. Tokens encrypted at rest, never in StudioState, exports, logs or public responses.
- Dedicated private persistence stores schedules and credential state; the demo stores only synthetic schedules and never connects a real Google account. Google writes occur outside aggregate compare-and-swap callbacks.
- Creating/rescheduling/cancelling a saved shoot attempts Google synchronization. Studio save and Google sync are distinct statuses. Failure leaves a visible retry action, not a false success message.
- Stable event identity prevents duplicates on retry. Concurrency must not let an older reschedule overwrite the newest schedule unnoticed. Disconnect removes stored credentials, not unrelated Google events.
- Without owner-supplied OAuth configuration the UI remains useful for planning and honestly says setup is required. Documentation explains API enablement, consent publishing/testing limitations, encryption key, redirect registration and notification permissions. No claims of tested live Google delivery without real consent.

## Visual and interaction system

- Soft lavender day palette, deep violet night palette, high-contrast text, remembered preference with system default. Theme applies to public, login, shared forms, studio and portal dialogs.
- Photography-led editorial public page, asymmetric collage, work grid, section reveals, gentle image motion. No scroll hijacking, autoplay obstruction, fake metrics or testimonials.
- Mobile-first, 44px controls, legible labels, native date/time inputs, focused forms, keyboard navigation, visible focus, accessible dialogs, reduced-motion support. Content remains available without animation APIs.
- Verify at 320, 390, 768, 1024 and 1440 pixels in both themes; internal table overflow is acceptable, document overflow is not.

## Non-goals and constraints

- No Git initialization or history-changing commands. Preserve inherited unrelated instruction/config files.
- Existing TypeScript/Next/Neon security boundaries remain. Do not substitute Python architecture.
- No expenses, taxes, payment gateway, multi-user scheduling or public shoot location disclosure.
- OAuth setup/deployment and device reminder permissions require the account owner; no secrets through chat.

## Approved scroll correction — 2026-10-01

The initial public motion was too subtle and completely disabled below 900px. User explicitly approved a visibly cinematic scroll treatment after reproducing the missing effect in a 320px preview. Supersedes the earlier touch-static decision: scroll-driven photo depth/rotation now works at all widths and on touch, with a shorter/lighter composition on phones. A native sticky scene provides a bounded scroll interval; work images also parallax below the hero. Cursor effects remain fine-pointer desktop-only. Reduced-motion and no-JavaScript layouts have no extra sticky travel, and native links/scrolling are unchanged.