---
description: "Use when writing, reviewing, or fixing Alembic database migrations. Covers idempotent DDL, single head, reversibility, zero-downtime expand/contract, concurrent indexes, and migration failure modes."
applyTo: "alembic/**"
---

# Migrations

A migration that fails when re-run is a broken migration. A migration that cannot be rolled back is
a broken migration. Both have cost us before.

For the full step-by-step procedure with templates and the safety checker, use the
`/create-a-migration` skill.

## Idempotency

Every DDL statement must be safe to run twice. PostgreSQL supports this directly:

```python
op.execute("ALTER TABLE agreement ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2)")
op.execute("DROP INDEX IF EXISTS ix_agreement_risk_score")
op.execute("CREATE INDEX IF NOT EXISTS ix_agreement_status ON agreement (status)")
```

Where the Alembic op has no `IF NOT EXISTS` equivalent, guard with an inspector:

```python
def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}

def upgrade() -> None:
    if not _has_column("agreement", "risk_score"):
        op.add_column("agreement", sa.Column("risk_score", sa.Numeric(5, 2)))
```

Enum values, constraints, and indexes all need the same treatment. Adding an enum value:

```python
op.execute("ALTER TYPE agreement_status ADD VALUE IF NOT EXISTS 'terminated'")
```

## Single head, always

Two heads means a merge conflict nobody noticed. Before opening a PR:

```bash
uv run alembic heads          # must print exactly one
uv run alembic branches       # must print nothing
```

CI enforces this. If you have two heads, `alembic merge` — do not hand-edit `down_revision`.

## Reversibility

`downgrade()` is written and tested, never `pass`. CI runs `upgrade head` → `downgrade -1` →
`upgrade head` against a real PostgreSQL container.

Where a downgrade genuinely cannot restore data (a dropped column), the downgrade must still restore
the **schema**, and the migration docstring must state what data is unrecoverable.

## Never destructive in one step

Renaming a column or changing its type is a three-release **expand/contract**, not one migration:

1. **Expand** — add the new column, backfill, dual-write in application code. Old column untouched.
2. **Migrate** — deploy code that reads the new column.
3. **Contract** — drop the old column, in a later release, after verifying nothing reads it.

Dropping a column, dropping a table, or narrowing a type in the same release as the code change
will break the running instance during rollout, because old and new pods overlap.

Any migration containing `drop_column`, `drop_table`, or a narrowing `alter_column` requires an
explicit note in the PR description confirming the expand phase shipped previously.

## Locks and large tables

- **Indexes on non-empty tables**: `CREATE INDEX CONCURRENTLY`. This cannot run inside a
  transaction, so the migration needs `def upgrade(): op.execute("COMMIT")` first, or
  `transaction_per_migration = False` configured for that revision.
- **`ADD COLUMN` with a volatile default** rewrites the table. Add the column nullable, backfill in
  batches, then set the default and the `NOT NULL`.
- **`SET NOT NULL`** takes an ACCESS EXCLUSIVE lock and scans. Add a `NOT VALID` check constraint,
  validate it separately, then set `NOT NULL`.
- Backfills of more than ~50k rows belong in a batched data migration or a one-off job, not in the
  DDL migration.

## Data migrations

- Never import an ORM model into a migration. Models change; the migration must keep working against
  the schema as it was. Use `sa.table()` / `sa.column()` literals.
- Batch with an explicit `LIMIT` loop and commit per batch.
- Make backfills idempotent with a `WHERE column IS NULL` guard, so a re-run does no work.

## Naming and hygiene

- One logical change per migration. Do not combine an index addition with a data backfill.
- Revision message describes the change: `add_risk_score_to_agreement`, not `update_tables`.
- Never edit a migration that has run in `uat` or `prod`. Write a new one.
- Never delete a migration file to "clean up history".

## Checklist before opening the PR

1. `alembic heads` prints one head.
2. `upgrade head` succeeds on an empty database.
3. `upgrade head` run twice in a row succeeds — no error on the second run.
4. `downgrade -1` then `upgrade head` succeeds.
5. No `drop_*` without a documented expand phase.
6. `uv run python scripts/check_migration_safety.py` passes.
