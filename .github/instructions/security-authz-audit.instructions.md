---
description: "Use when handling authentication, authorization, permissions, record-level access scope, file attachments and downloads, SAS tokens, audit logging, or PII in the backend. Security-critical rules for the contracts platform."
applyTo: "app/**/*.py"
---

# Security, authorization, and audit

Contracts are confidential and legally binding. Assume every endpoint will be called directly, with
a valid token, by a user who should not see the record. Make that call fail server-side.

## Authentication

- Entra ID JWTs, validated on every request: signature against the tenant JWKS (cached, refreshed on
  `kid` miss), plus `iss`, `aud`, `exp`, `nbf`, and `tid`.
- Never decode without verifying. Never trust a claim the token did not carry.
- Reject tokens whose `tid` is not the Zoetis tenant, even if the signature validates.
- Service principals authenticate the same way and are subject to the same permission checks. They
  are not privileged by virtue of being machines.
- The validated identity becomes a `Principal` (user id, roles, permissions, scope keys) built once
  per request and injected via `Depends`.

## Authorization — deny by default

Every route declares a required permission from `docs/PERMISSIONS.md`:

```python
@router.get("/{agreement_id}", operation_id="getAgreement")
async def get_agreement(
    agreement_id: UUID,
    service: Annotated[AgreementService, Depends(get_agreement_service)],
    _: Annotated[None, Depends(require("agreement:read"))],
) -> AgreementRead: ...
```

A route without a `require(...)` dependency fails CI. There is no implicit-allow path.

Permission names are never invented inline — they come from `app/core/permissions.py`, which mirrors
`docs/PERMISSIONS.md` exactly, and that file is byte-identical to the frontend's copy.

## Record-level scope — enforced in the repository

A permission grants an action *type*. It never grants access to a specific record. Scope filtering
lives in `ScopedRepository`, applied to every query automatically, so no endpoint can forget it.

```python
class ScopedRepository(Generic[ModelT]):
    def _scoped(self, stmt: Select) -> Select:
        if self.scope.is_platform_admin:
            return stmt
        return stmt.where(
            or_(
                self.model.id.in_(self.scope.participant_record_ids(self.model)),
                and_(
                    self.model.business_unit_id.in_(self.scope.business_unit_ids),
                    self.model.is_confidential.is_(False),
                ),
                and_(
                    self.model.legal_entity_id.in_(self.scope.legal_entity_ids),
                    self.scope.has_role("legal_counsel"),
                    self.model.is_confidential.is_(False),
                ),
            )
        )
```

Rules:

- A repository method that builds a `select()` without passing it through `_scoped()` is a security
  bug. Raw `session.execute()` in a service is a layering *and* security violation.
- Out-of-scope records return **404, not 403** — a 403 confirms the record exists.
- The same scope predicate filters RAG retrieval. A user must never receive a generated answer
  citing a contract they cannot open.

## Attachments — the incognito-URL problem

**A Blob URL is never returned to a client, logged, cached, or embedded in a response.** Copying a
URL into a private window must produce nothing.

Download flow, every time:

1. Client calls `POST /api/v1/attachments/{id}/download-token`.
2. Backend re-checks `attachment:download` **and** record scope for the parent agreement. Not
   cached, not inherited from the list call that produced the id.
3. Backend mints a **user-delegation SAS** via `DefaultAzureCredential` — never an account key —
   scoped to that single blob, read-only, expiring in **≤ 5 minutes**, with
   `Content-Disposition: attachment` and the correct content type pinned in the SAS.
4. Backend writes an `AuditEvent` recording who requested which attachment, when, and from where.
5. Client redirects to the URL immediately; the frontend never persists it.

Additional rules:

- Blob containers are **private**. No anonymous access, ever. Verified in CI against the storage
  account configuration.
- Blob names are opaque UUID paths, never original filenames — filenames leak counterparty names.
- Uploads are validated by content sniffing, not extension, and size-capped before streaming to
  Blob. Store the original filename as metadata for display only.
- Never render user-supplied HTML or SVG from an attachment inline.

## Audit

Every mutation writes an immutable `AuditEvent`: actor id, action, entity type, entity id, `before`
and `after` JSONB, correlation id, source IP, timestamp.

- Written in the same transaction as the change. If the audit write fails, the mutation rolls back.
- Append-only. No `UPDATE`, no `DELETE`, no cascade from the parent record.
- Reads are audited too, for attachment downloads, exports, and AI queries over confidential
  agreements.
- Emitted through the service base helper, never inline.

## Logging and PII

- Structured JSON logs with a correlation id on every line, propagated from the request header or
  generated per request.
- Never log: tokens, SAS URLs, secrets, contract body text, extracted clause content, counterparty
  contact details.
- Log entity **ids**, not entity contents. A redaction filter is installed on the root logger as a
  backstop, not as the primary control.
- Exception handlers log the full detail server-side and return only the generic envelope.

## Input handling

- Every input is a Pydantic model. No raw `request.json()`.
- SQL is always parameterised via SQLAlchemy constructs. Never f-string a value or a column name
  into a query — `sort` and filter fields map through an allow-list.
- Rate-limit authentication-adjacent and AI endpoints via Redis.
- CORS allows the specific frontend origin per environment. Never `*`, never with credentials.
