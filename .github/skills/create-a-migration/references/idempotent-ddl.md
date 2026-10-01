# Idempotent DDL patterns

Copy-paste reference for the `create-a-migration` skill. Every pattern here is safe to run twice.

## Inspector helpers

Put these at the top of any migration that needs guarded DDL.

```python
import sqlalchemy as sa
from alembic import op


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_index(table: str, index: str) -> bool:
    if not _has_table(table):
        return False
    return index in {i["name"] for i in _inspector().get_indexes(table)}


def _has_constraint(table: str, name: str) -> bool:
    if not _has_table(table):
        return False
    insp = _inspector()
    names = {c["name"] for c in insp.get_check_constraints(table)}
    names |= {f["name"] for f in insp.get_foreign_keys(table)}
    names |= {u["name"] for u in insp.get_unique_constraints(table)}
    pk = insp.get_pk_constraint(table).get("name")
    if pk:
        names.add(pk)
    return name in names
```

## Columns

```python
def upgrade() -> None:
    op.execute("ALTER TABLE agreement ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2)")


def downgrade() -> None:
    op.execute("ALTER TABLE agreement DROP COLUMN IF EXISTS risk_score")
```

With the Alembic op API when you need its type handling:

```python
def upgrade() -> None:
    if not _has_column("agreement", "risk_score"):
        op.add_column("agreement", sa.Column("risk_score", sa.Numeric(5, 2), nullable=True))
```

## Tables

```python
def upgrade() -> None:
    if _has_table("obligation"):
        return
    op.create_table(
        "obligation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("agreement_id", sa.Uuid(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["agreement_id"], ["agreement.id"], name="fk_obligation_agreement_id"
        ),
        sa.CheckConstraint("due_date IS NOT NULL", name="ck_obligation_due_date_present"),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS obligation")
```

Always name foreign keys, checks, and unique constraints. An auto-generated name cannot be dropped
reliably in `downgrade()`.

## Indexes

Small or empty table:

```python
op.execute("CREATE INDEX IF NOT EXISTS ix_agreement_status ON agreement (status)")
op.execute("DROP INDEX IF EXISTS ix_agreement_status")
```

Non-empty table — build without an exclusive lock. `CONCURRENTLY` cannot run inside a transaction,
so commit first:

```python
def upgrade() -> None:
    op.execute("COMMIT")
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_agreement_end_date ON agreement (end_date)"
    )


def downgrade() -> None:
    op.execute("COMMIT")
    op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_agreement_end_date")
```

A failed `CONCURRENTLY` build leaves an invalid index behind. Re-running is safe because of
`IF NOT EXISTS`, but check `pg_index.indisvalid` if a build was interrupted.

GIN index for dynamic attributes:

```python
op.execute(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_agreement_attributes "
    "ON agreement USING gin (attributes)"
)
```

## Enums

Creating:

```python
agreement_status = sa.Enum(
    "draft", "pending_approval", "approved", "pending_execution",
    "active", "expiring", "expired", "rejected", "cancelled", "terminated",
    name="agreement_status",
)


def upgrade() -> None:
    agreement_status.create(op.get_bind(), checkfirst=True)
```

Adding a value — note this cannot run inside a transaction block on older PostgreSQL, and cannot be
undone:

```python
def upgrade() -> None:
    op.execute("ALTER TYPE agreement_status ADD VALUE IF NOT EXISTS 'terminated'")


def downgrade() -> None:
    """PostgreSQL cannot drop an enum value. Removing it requires recreating the
    type, which is unsafe while rows reference it. Downgrade is intentionally a
    no-op for this statement; the value remains but is unused."""
```

Removing a value is a type recreation. Treat it as a destructive change and use expand/contract.

## Constraints

Adding `NOT NULL` without a long exclusive lock:

```python
def upgrade() -> None:
    # 1. Validate cheaply as NOT VALID — no full scan, no blocking.
    if not _has_constraint("agreement", "ck_agreement_owner_present"):
        op.execute(
            "ALTER TABLE agreement ADD CONSTRAINT ck_agreement_owner_present "
            "CHECK (owner_id IS NOT NULL) NOT VALID"
        )
    # 2. Validate separately — scans, but takes only a SHARE UPDATE EXCLUSIVE lock.
    op.execute("ALTER TABLE agreement VALIDATE CONSTRAINT ck_agreement_owner_present")
```

## Backfills

Batched, idempotent, and re-runnable. The `IS NULL` guard means a second run does no work.

```python
def upgrade() -> None:
    agreement = sa.table(
        "agreement",
        sa.column("id", sa.Uuid),
        sa.column("risk_score", sa.Numeric),
    )
    bind = op.get_bind()
    while True:
        result = bind.execute(
            sa.text(
                """
                UPDATE agreement
                SET risk_score = 0
                WHERE id IN (
                    SELECT id FROM agreement WHERE risk_score IS NULL LIMIT 5000
                )
                """
            )
        )
        if result.rowcount == 0:
            break
```

Never import the ORM model here. `sa.table()` / `sa.column()` literals pin the migration to the
schema as it was at that revision.

## Adding a column with a default to a large table

```python
def upgrade() -> None:
    # 1. Nullable, no default — instant, no rewrite.
    op.execute("ALTER TABLE agreement ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2)")
    # 2. Backfill in batches (see above).
    # 3. Then set the default for future rows.
    op.execute("ALTER TABLE agreement ALTER COLUMN risk_score SET DEFAULT 0")
```

PostgreSQL 11+ handles a constant default without a rewrite, but a volatile default still rewrites
the table. When in doubt, use the three-step form.

## Renaming — never in one migration

Renaming `agreement.owner` to `agreement.owner_id` is expand/contract across three releases:

```python
# Release 1 — expand
op.execute("ALTER TABLE agreement ADD COLUMN IF NOT EXISTS owner_id UUID")
# backfill owner_id from owner; application dual-writes both

# Release 2 — migrate
# application reads owner_id only

# Release 3 — contract
op.execute("ALTER TABLE agreement DROP COLUMN IF EXISTS owner")
```

Doing it in one step breaks every instance still running the previous image during rollout.
