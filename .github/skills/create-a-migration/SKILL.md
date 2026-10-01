---
name: create-a-migration
description: 'Create, review, or fix an Alembic database migration for Z-CIP. Use when adding or changing a table, column, index, constraint, or enum value, when backfilling data, or when a migration fails to apply. Enforces idempotent DDL, single head, reversibility, and zero-downtime expand/contract.'
argument-hint: 'what the migration should change, e.g. "add risk_score to agreement"'
---

# Create a migration

Migrations have failed us before in two specific ways: a migration that errors when re-run because
the column already exists, and a migration that cannot be rolled back. Both are preventable by
following this procedure exactly.

## Procedure

Work through these in order. Do not skip step 1 — a migration for a table that should not exist is
worse than no migration.

### 1. Check the entity registry

Read `docs/domain/ENTITY_REGISTRY.md`. Search it for the concept **and its synonyms**.

- Creating a table → the entity must already have a registry row, or you add one in this PR.
- Adding a column → confirm the concept does not belong on a different existing entity.
- If you are about to create something that looks like an existing entity under a new name, stop and
  extend the existing one instead.

### 2. Confirm a single head

```bash
uv run alembic heads      # exactly one line
uv run alembic branches   # no output
```

Two heads → `uv run alembic merge -m "merge heads" <rev1> <rev2>`. Never hand-edit `down_revision`.

### 3. Generate the revision

```bash
uv run alembic revision --autogenerate -m "add_risk_score_to_agreement"
```

Autogenerate is a **draft**. It regularly misses server defaults, enum changes, index method
choices, and constraint names, and it never produces idempotent DDL. You will rewrite most of it.

### 4. Rewrite for idempotency

Every statement must be safe to run twice. See [idempotent DDL patterns](./references/idempotent-ddl.md)
for the full set. The common cases:

```python
op.execute("ALTER TABLE agreement ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2)")
op.execute("CREATE INDEX IF NOT EXISTS ix_agreement_status ON agreement (status)")
op.execute("ALTER TYPE agreement_status ADD VALUE IF NOT EXISTS 'terminated'")
```

Where no `IF NOT EXISTS` form exists, guard with the inspector helpers in the reference file.

### 5. Write the downgrade

`downgrade()` is never `pass`. It restores the previous **schema**. Where data cannot be recovered,
say so in the migration docstring.

### 6. Check for destructive operations

`drop_column`, `drop_table`, `drop_constraint`, and narrowing `alter_column` cannot ship in the same
release as the code change — during rollout, old and new instances run concurrently, and the old
code will query a column that no longer exists.

Use expand/contract:

1. **Expand** — add the new column, backfill, dual-write. Old column untouched.
2. **Migrate** — deploy code reading the new column.
3. **Contract** — drop the old column in a later release.

If this migration contains a destructive operation, state in the PR description which earlier
release shipped the expand phase.

### 7. Consider locks

- Index on a non-empty table → `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction.
- `ADD COLUMN` with a volatile default → add nullable, backfill in batches, then set the default.
- `SET NOT NULL` → add a `NOT VALID` check, validate separately, then set `NOT NULL`.
- Backfill over ~50k rows → batched, with a `WHERE ... IS NULL` guard so re-runs do no work.

Details and code for each in the reference file.

### 8. Run the safety checker

```bash
uv run python scripts/check_migration_safety.py
```

It fails on non-idempotent DDL, an empty downgrade, ORM imports, undeclared destructive operations,
and multiple heads. The `PostToolUse` hook runs it automatically after you edit a migration, and CI
runs it on every PR.

### 9. Verify against a real database

All four must pass. The second is the one that catches the failure mode we keep hitting.

```bash
uv run alembic upgrade head     # 1. applies cleanly
uv run alembic upgrade head     # 2. re-run is a no-op, no error
uv run alembic downgrade -1     # 3. rolls back
uv run alembic upgrade head     # 4. re-applies
```

### 10. Update the registry

New table or changed entity meaning → update `docs/domain/ENTITY_REGISTRY.md` in this PR.

## Rules that have no exceptions

- Never import an ORM model into a migration. Models change; migrations must keep working against
  the schema as it was. Use `sa.table()` / `sa.column()` literals.
- Never edit a migration that has run in `uat` or `prod`. Write a new one.
- Never delete a migration file to tidy history.
- One logical change per migration. Do not combine an index addition with a data backfill.
- Name constraints explicitly. Alembic cannot reliably drop what it cannot name.

## Checklist

- [ ] Entity registry checked, and updated if needed
- [ ] `alembic heads` shows exactly one head
- [ ] Every DDL statement is idempotent
- [ ] `downgrade()` is implemented and tested
- [ ] No undeclared destructive operation
- [ ] Concurrent index / batched backfill where the table is non-empty
- [ ] No ORM imports
- [ ] Safety checker passes (`uv run python scripts/check_migration_safety.py`)
- [ ] Upgrade, re-run, downgrade, re-upgrade all verified
