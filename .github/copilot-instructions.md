# Z-CIP Backend

Contract intelligence platform for Zoetis — the in-house replacement for Icertis CLM. This repo is
the API, domain model, and RAG pipeline. The React frontend is a separate repo and consumes this
service's OpenAPI schema.

Contracts are legally binding and commercially sensitive. Security, auditability, and data
correctness outrank delivery speed on every decision.

## Stack

Python 3.12+ · FastAPI (fully async) · SQLAlchemy 2.0 async · Alembic · Pydantic v2 ·
Azure PostgreSQL Flexible Server · Azure AI Search · Azure Blob Storage · Redis ·
`uv` for dependencies · pytest + testcontainers · ruff + mypy strict

Deployed as a container from ACR to Azure App Service. No IaC in this repo — resources are
provisioned externally and consumed through Key Vault references and a user-assigned managed
identity.

## Layout

```
app/
  api/          FastAPI routers. HTTP only: parse, authorize, delegate, serialize.
  services/     Business logic and orchestration. No HTTP, no raw SQL.
  repositories/ Data access. The ONLY layer that touches SQLAlchemy sessions.
  models/       SQLAlchemy ORM models.
  schemas/      Pydantic request/response models. Never reused as ORM models.
  rag/          Ingestion, chunking, embedding, retrieval, generation.
  core/         Config, security, permissions, logging, dependencies.
alembic/        Migrations.
tests/          Mirrors app/. Integration tests use testcontainers, not mocks.
docs/           Entity registry, permissions, Azure resources.
```

Imports flow **downward only**: `api → services → repositories → models`. A repository importing a
service, or a model importing anything from `app/`, is a bug.

## Commands

```bash
uv sync                          # install
uv run fastapi dev app/main.py   # run locally
uv run pytest                    # tests
uv run ruff check --fix .        # lint
uv run ruff format .             # format
uv run mypy app                  # types
uv run alembic upgrade head      # apply migrations
uv run alembic downgrade -1      # roll back one
```

All four of `ruff check`, `ruff format --check`, `mypy`, and `pytest` must pass before a PR merges.

## Golden rules

1. **Read `docs/domain/ENTITY_REGISTRY.md` before creating any model or table.** If the concept
   exists, extend it. Duplicate tables for one concept is the most expensive mistake here.
2. **Authorization is deny-by-default and enforced server-side.** Every endpoint declares a required
   permission. Every query is filtered by record scope in the repository layer. Never trust the
   client.
3. **Blob URLs are never returned to a client.** Downloads are brokered: re-check authorization,
   mint a short-lived user-delegation SAS, write an audit event.
4. **Migrations must be idempotent and reversible.** A migration that fails when re-run, or that
   cannot be rolled back, does not merge. See the `create-a-migration` skill.
5. **Every mutation writes an `AuditEvent`** with actor, before, after, and correlation id.
6. **Write the failing test first.** Test behaviour through the public interface. Never mock the
   thing under test; use testcontainers for the database.
7. **One responsibility per module.** When a file needs "and" to describe it, split it.
8. **Search before you create.** Grep for an existing service, repository method, or utility before
   writing a new one.
9. **`operation_id` on every route.** The frontend generates its entire API client from this
   schema; unstable operation ids break their build.
10. **Never log a secret, token, or contract body.** Structured logs only, with correlation ids and
    PII redaction.

## Git

**Never run `git add`, `git commit`, `git push`, or any other history-changing git command.** Edit
files and report what changed; a human reviews the diff and decides what enters history. This is
enforced by a `PreToolUse` hook, not left to judgement.

Read-only git — `status`, `diff`, `log`, `show`, `branch` — is allowed and encouraged for
understanding the current state.

## Enforcement

Some rules here are checked automatically rather than trusted:

| Check | Script | Runs |
|---|---|---|
| Entity registry | `scripts/check_entity_registry.py` | Hook + CI |
| Route authorization | `scripts/check_route_authz.py` | Hook + CI |
| Migration safety | `scripts/check_migration_safety.py` | Hook + CI |

A `PostToolUse` hook runs the relevant checker after an edit and blocks on failure. The same
scripts run in CI, which is the real boundary — hooks only cover agent sessions in VS Code.

## Configuration

Settings come from environment variables via a single Pydantic `Settings` object in `app/core/`.
Secrets are Key Vault references resolved by App Service into env vars — the app never calls Key
Vault directly for app settings. Service-to-service auth uses `DefaultAzureCredential` with a UAMI.
No connection strings, keys, or passwords in code, config files, or CI.

## Detailed standards

| Area | File |
|---|---|
| Layering, SOLID, dependency injection | `.github/instructions/architecture-and-solid.instructions.md` |
| Models, schemas, dynamic attributes | `.github/instructions/domain-model.instructions.md` |
| Alembic safety rules | `.github/instructions/migrations.instructions.md` |
| REST conventions, pagination, errors | `.github/instructions/api-design.instructions.md` |
| AuthN, authZ, attachments, audit | `.github/instructions/security-authz-audit.instructions.md` |
| RAG pipeline and guardrails | `.github/instructions/rag.instructions.md` |
| Azure resources, config, CI/CD | `.github/instructions/azure-and-config.instructions.md` |
| Dependencies and vulnerabilities | `.github/instructions/dependencies.instructions.md` |
| Testing | `.github/instructions/testing.instructions.md` |

Workflows with templates and checks: `/create-a-migration`, `/add-a-domain-entity`.
