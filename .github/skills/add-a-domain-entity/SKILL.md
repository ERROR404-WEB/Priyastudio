---
name: add-a-domain-entity
description: 'Add a new domain entity to the Z-CIP backend — model, schema, repository, service, router, permissions, migration, and tests. Use when creating a new database table or business object such as an agreement, clause, obligation, or contract type. Enforces the entity registry gate that prevents duplicate tables for the same concept.'
argument-hint: 'the entity name and what it represents, e.g. "Obligation - a commitment arising from an agreement"'
---

# Add a domain entity

Two tables for the same concept is the most expensive mistake in this codebase and it has happened
before. Step 1 exists to make it impossible. Do not skip it, even when the entity is obviously new.

An entity is not done when the table exists. It is done when it has scoped access, audited
mutations, permissions in both repos, and tests proving an unauthorized caller is refused.

## Procedure

### 1. The registry gate — before writing any code

Read `docs/domain/ENTITY_REGISTRY.md` and search it for the concept **and its synonyms**. The
registry lists known collisions: Vendor/Supplier/Customer are one entity, Doc/File/Attachment are
one entity, Commitment/Compliance/Obligation are one entity.

Then decide:

| Finding | Action |
|---|---|
| Exact concept exists | **Stop.** Extend it — add a column, a status value, or a JSONB key. |
| A variant of an existing entity | Use a discriminator column or a self-reference. No new table. |
| Listed under "Deferred concepts" | Use the reserved name and meaning. Do not redefine it. |
| Genuinely new | Add the registry row **now**, in this PR, before creating the model. |

State explicitly which of these applies before continuing.

Skeletons for every layer below are in [layer templates](./references/layer-templates.md).

### 2. Define the boundary

Answer these before writing code. If you cannot, the entity is not understood well enough to model.

- What does it do, in one sentence with no "and"?
- Who owns a record — which business unit, which legal entity?
- Who may read it, and who may change it?
- What are its states, and which transitions are legal?
- Is it confidential, or can it inherit its parent's confidentiality?
- What must the audit trail capture?

### 3. Model

`app/models/<entity>.py`, inheriting `TimestampedBase`. Add `business_unit_id` and, where relevant,
`legal_entity_id` — the repository filters on these, and an entity without them cannot be scoped.

Follow `.github/instructions/domain-model.instructions.md`: UUIDv7 keys, `TIMESTAMPTZ`, `NUMERIC`
for money, named constraints, JSONB + GIN for dynamic attributes, explicit `selectinload` rather
than lazy loading.

### 4. Schemas

`app/schemas/<entity>.py` — four models, never reusing the ORM class:

- `<Entity>Create` — what a client may supply on create
- `<Entity>Update` — all fields optional, for `PATCH`
- `<Entity>Read` — the detail payload
- `<Entity>Summary` — the narrower shape lists return

Never expose scope keys, storage paths, or embeddings through a `Read` schema without a deliberate
decision.

### 5. Repository

`app/repositories/<entity>.py`, extending `ScopedRepository`. Every `select()` passes through
`_scoped()`. A query that bypasses it is a security bug, not a style issue.

Pagination, sorting, and filtering come from the base class. Do not reimplement them per entity —
that is how list endpoints start behaving differently from each other.

### 6. Service

`app/services/<entity>.py` — business rules, state transitions, and audit emission. No `fastapi`
imports, no HTTP status codes, no raw SQL.

State transitions are explicit methods (`approve`, `terminate`), never a generic `update` that
accepts a new status. Each validates the transition is legal from the current state.

Every mutation emits an `AuditEvent` through the service base helper, in the same transaction.

### 7. Permissions

Add the rows to `docs/PERMISSIONS.md` **in both repos, in the same PR**, keeping the files
byte-identical. Then add the constants to `app/core/permissions.py`.

Standard set: `<entity>:read`, `<entity>:create`, `<entity>:update`, `<entity>:delete`, plus
`:approve` or `:export` where the entity needs them.

### 8. Router

`app/api/<entity>.py`. Every route declares `Depends(require("<entity>:<action>"))` and an explicit
camelCase `operation_id` — the frontend generates its hooks from those names.

Follow `.github/instructions/api-design.instructions.md`: `PATCH` not `PUT`, sub-resource `POST` for
transitions, page size 10 by default, `response_model` on every route.

### 9. Migration

Use the `/create-a-migration` skill. Do not hand-roll it — the idempotency and reversibility rules
are the whole point.

### 10. Tests

Write these **first**, watch them fail, then implement. Minimum coverage:

- Repository: an out-of-scope record is excluded from list and get. This is the test that catches a
  forgotten `_scoped()`.
- Service: each legal state transition succeeds; each illegal one raises.
- Service: every mutation writes an `AuditEvent` with correct before and after.
- API: authorized caller succeeds.
- API: authenticated caller without the permission gets `403`.
- API: caller with the permission but an out-of-scope record gets **`404`**, and the body reveals
  nothing.
- API: no token gets `401`.
- API: list defaults to page size 10 and respects `sort` and `order`.

### 11. Frontend handoff

Once the endpoints are merged, the frontend runs `npm run api:generate`. Nothing further is needed
from this repo — but a renamed `operation_id` breaks their build, so treat those names as public API.

## Checklist

- [ ] Registry searched; outcome stated; row added if new
- [ ] Boundary questions answered
- [ ] Model inherits `TimestampedBase` and carries scope keys
- [ ] Four schemas, separate from the ORM model
- [ ] Repository extends `ScopedRepository`; every query scoped
- [ ] Service holds the rules; no FastAPI imports
- [ ] Explicit transition methods, not a status-setting update
- [ ] Audit event on every mutation
- [ ] Permissions added to both repos' `PERMISSIONS.md`, byte-identical
- [ ] Every route has `require(...)` and a stable `operation_id`
- [ ] Migration created via `/create-a-migration`
- [ ] Authorization and scope tests written first and passing
