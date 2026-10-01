# Studio browser acceptance specification

Run against a local demo server only; never create synthetic receipts in production.

## Shell and access
- At desktop 1440×1000, all eight routes load under the 238px sidebar. Current route is announced with aria-current. The public portfolio link works.
- At 390×844 and 320×740, the body never overflows horizontally. Mobile navigation opens a named modal, traps focus, closes on Escape and on route selection, and restores focus to its trigger.
- With GET /api/studio returning 401, the studio redirects to /login; 503 instead shows setup guidance with Retry. A failed request never displays synthetic fallback data.
- Login submits a digits-only phone username with the entered password. Failed auth stays on the form with an inline error. Try demo studio appears only after a successful unauthenticated GET explicitly reports demo=true.
- Search filters the current data page; on Overview and Settings it displays navigable global results. No-match states are visible.

## Persistent creation and money
1. Create a brand with contact, email, category and notes. Create a collaboration for that brand, uploading a valid image and specifying its date and stage.
2. Edit its stage/date/description/reel and publish state. Reload; all changes persist. Switch grid/list/board; stage select remains keyboard-operable.
3. Fill all profile details, including issuer and payment instructions. Create a draft invoice with 2 × ₹500.01 = ₹1,000.02. Verify brand and issuer snapshots; draft does not increase receivables. Issue it; server number appears.
4. Record ₹250.01 for the issued invoice, using today's date. Outstanding becomes ₹750.01. Reload and verify ledger and dashboard. Future dates, zero, excess balance and fractional paise are blocked.
5. Simulate a dropped payment response; retry without closing the form. Assert the same payment ID is submitted and no second receipt is added. Receipt fields remain unchanged after an uncertain submission.
6. Complete the balance; it is no longer offered in the receipt selector. Reverse a receipt only through the confirmation modal. History remains visible and balance updates. An invoice with active receipts cannot be voided.
7. Download the persisted invoice PDF. Verify invoice number, snapshots, receipt totals and explicit demo watermark when applicable.

## Proposals, links and testimonials
- Create a multi-line rate card, rights, timeline and expiry. Share it: dialog exposes the returned server URL, copy only announces success after clipboard resolves, and fallback URL is selectable. Existing links can be revoked, with a confirmation.
- Sent/accepted proposal prices cannot be edited. Copy as new draft preserves original terms; saving creates a separate ID. Show acceptance identity, version and date, comments, requested date and counter-offer without mutating original terms.
- Request a review for one collaboration. Submit through the public review page (main-owned). In Portfolio, a review without consent cannot be approved; a consenting review can be approved/unapproved. Only an approved review for published work is public.
- Revoking a proposal/review link updates its displayed status; never render token hashes.

## Accessibility and resilience
- Every modal has a title, description and accessible close button; every input has a visible label. All actions are keyboard-accessible with visible focus and 44px targets.
- API errors are visible in the form and shared error region. Pending saves disable duplicate submissions. Upload failures do not clear the prior image.
- Empty collections have a real next step; demo financial examples are visibly labeled. The revenue SVG has a title and a full accessible monthly-value list.
- Settings exports the currently authorized server state as JSON; production data is never loaded from seed or localStorage.