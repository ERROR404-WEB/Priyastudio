---
description: "Use when writing or fixing backend tests — pytest structure, testcontainers, fixtures, what to mock and what never to mock, authorization test requirements, and migration testing."
applyTo: "tests/**,conftest.py"
---

# Testing

Write the failing test first. It must fail for the reason you expect before you write the
implementation — a test that passes against an empty implementation is testing nothing.

## Structure

`tests/` mirrors `app/`. Three tiers:

| Tier | Scope | Database |
|---|---|---|
| `tests/unit/` | Pure logic — validators, rule evaluation, chunking | None |
| `tests/integration/` | Repositories and services | Real PostgreSQL via testcontainers |
| `tests/api/` | Routes end to end through the ASGI app | Real PostgreSQL via testcontainers |

## Never mock the thing under test

- Testing a repository → use a real database. A mocked `Session` proves your mock works.
- Testing a service → use real repositories against the test database. Mock only what crosses a
  process boundary you do not own.
- **Do mock**: Azure OpenAI, Azure AI Search, outbound email, the clock.
- **Never mock**: PostgreSQL, SQLAlchemy, Pydantic, FastAPI, your own layers.

Blob storage uses Azurite in a container rather than a mock, because SAS generation and content
disposition behaviour are exactly what we need to verify.

## Fixtures

- One session-scoped PostgreSQL container. Per-test isolation is a transaction rolled back in
  teardown, not a schema rebuild.
- Schema is created by running **`alembic upgrade head`**, never `Base.metadata.create_all()`. If
  migrations are broken, the test suite must be the thing that notices.
- Factories, not fixture soup. `AgreementFactory(status="active")` beats fifteen near-identical
  fixtures.
- Deterministic data. No `random`, no `datetime.now()` in assertions — freeze the clock.

## Authorization tests are mandatory

Every endpoint needs, at minimum:

1. Authorized caller with correct role and in-scope record → success.
2. Authenticated caller **without** the permission → `403`.
3. Authenticated caller **with** the permission but the record is out of scope → `404`, and the
   response body must not reveal existence.
4. No token or an invalid token → `401`.

Every repository method that returns records needs a test proving out-of-scope rows are excluded.
This is the test that catches a forgotten `_scoped()` call.

Attachment endpoints additionally need: a test proving no blob URL appears in any list or detail
response, and a test proving a minted SAS expires within the configured window.

## Migration tests

CI runs, against a real PostgreSQL container:

1. `alembic upgrade head` on an empty database.
2. `alembic upgrade head` **again** — must succeed, proving idempotency.
3. `alembic downgrade -1` then `alembic upgrade head`.
4. `alembic heads` returns exactly one head.

## RAG tests

- Retrieval is tested against a stubbed `Retriever` for logic, and against a real index in a nightly
  job for behaviour.
- The eval set in `tests/rag/evals/` asserts expected citations for known questions. Recall and
  groundedness thresholds are enforced; a drop fails the build.
- A prompt-injection fixture — a document containing "ignore previous instructions" — must not
  change the model's behaviour.

## What makes a good test here

- Name states the behaviour: `test_out_of_scope_agreement_returns_404`, not `test_get_agreement_2`.
- One behaviour per test. Multiple asserts are fine when they describe one outcome.
- Assert on the public interface — response body, database state — not on internal call counts.
- No sleeps. Use explicit waits or injected clocks.
- A test that needs a comment explaining what it does needs a better name instead.

## Coverage

Coverage is a signal, not a target. But these paths have no excuse for gaps: authorization
decisions, record-scope filters, attachment brokering, audit emission, and state transitions.
