---
description: "Use when creating or changing SQLAlchemy models, Pydantic schemas, database tables, or dynamic contract attributes. Covers the entity registry gate, base model contract, and JSONB usage."
applyTo: "app/models/**,app/schemas/**"
---

# Domain model

## The registry gate — do this first

**Before creating any model, read `docs/domain/ENTITY_REGISTRY.md` and search it for the concept
and its synonyms.** Vendor/Supplier/Customer are one entity. Doc/File/Upload are one entity.
Commitment/Compliance/Obligation are one entity.

- Concept exists → extend it with a column, a status value, or a JSONB key.
- Concept is a variant → use a discriminator column or a self-reference, not a new table.
- Concept is genuinely new → add the row to the registry in the **same PR** as the model.

A PR that adds a table without a registry row does not merge.

## Base model contract

Every table inherits these. No exceptions, no per-entity variation.

```python
class Base(DeclarativeBase): ...

class TimestampedBase(Base):
    __abstract__ = True

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"))
```

Records that participate in access scope also carry `business_unit_id` and, where relevant,
`legal_entity_id`. The repository layer filters on these — see the security instructions.

Rules:

- **UUIDv7 primary keys**, never sequential integers. Contract ids appear in URLs; enumerable ids
  leak volume and enable resource guessing.
- **Timezone-aware `TIMESTAMPTZ`** for every timestamp. Never naive datetimes, never `DATE` for
  something that has a time.
- **Soft delete only where legally required.** Prefer status transitions. If a table needs
  `deleted_at`, the repository base must exclude soft-deleted rows by default.
- **`NUMERIC` for money**, never `FLOAT`. Store the currency code alongside every amount.
- **Named constraints.** `ck_agreement_end_after_start`, not an auto-generated name — Alembic
  cannot reliably drop what it cannot name.

## Schemas are not models

`app/schemas/` holds Pydantic models for the wire. `app/models/` holds SQLAlchemy tables. They are
never the same class, and a model is never returned directly from a route.

Per entity, expect: `AgreementCreate`, `AgreementUpdate`, `AgreementRead`, `AgreementSummary`.
`Read` is the detail payload; `Summary` is the narrower shape lists return. Never expose an
internal column (scope keys, storage paths, embeddings) through a `Read` schema without a
deliberate decision.

## Dynamic attributes

Contract types define arbitrary metadata fields at runtime. **Do not build an EAV key/value table.**

- `AttributeDefinition` is a real table: code, display name, data type, source, mandatory, unique,
  tracking flag, contract type scope.
- Values live in an `attributes: Mapped[dict] = mapped_column(JSONB, default=dict)` column on the
  owning record.
- Index with GIN: `Index("ix_agreement_attributes", "attributes", postgresql_using="gin")`.
- Validate values against their definition in the **service** layer before persisting. The database
  cannot enforce this, so the service must.
- Frequently filtered attributes get a generated column plus a btree index — promote them, do not
  scan JSONB.

Rule metadata (`Rule.definition`) and extraction payloads follow the same pattern: JSONB with a
documented shape and a Pydantic model that parses it on read.

## Relationships

- Declare both sides only when both are actually traversed. An unused `back_populates` is a
  lazy-load waiting to fire.
- **Never rely on lazy loading in async code.** Use `selectinload` explicitly in the repository. A
  `MissingGreenlet` error at runtime means a lazy relationship escaped the query.
- Cascade deletes are opt-in and deliberate. An agreement deleting its audit trail is a compliance
  failure; the audit trail must survive.

## Enums

Domain statuses are PostgreSQL enums declared once and reused, so every list screen filters
identically. The vocabulary is fixed in the entity registry — extend it there first, and remember
that adding a value requires a migration.
