---
description: "Use when writing or refactoring backend Python — layering, SOLID, dependency injection, module boundaries, and avoiding duplication in the FastAPI service."
applyTo: "app/**/*.py"
---

# Architecture and SOLID

## Layers

```
api → services → repositories → models
```

Imports flow downward only. Each arrow is a one-way dependency.

| Layer | May do | Must never do |
|---|---|---|
| `api/` | Parse and validate input, declare required permission, call one service, serialize output | Contain business rules, touch a `Session`, build SQL, catch and swallow domain errors |
| `services/` | Orchestrate business rules, coordinate repositories, start transactions, emit audit events | Import `fastapi`, know about HTTP status codes, execute SQL |
| `repositories/` | Build and execute queries, apply record-scope filters, map rows to models | Contain business rules, call other repositories directly, know who the caller is beyond the scope context |
| `models/` | Declare tables, columns, relationships, constraints | Import anything from `app/services`, `app/api`, or `app/schemas` |

A router that reads `AsyncSession` is a layering violation. So is a service that returns a
`JSONResponse`.

## Dependency injection

Wire dependencies through FastAPI `Depends`, never module-level singletons or imports of concrete
implementations inside business logic.

```python
# app/api/deps.py
async def get_agreement_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    principal: Annotated[Principal, Depends(get_principal)],
) -> AgreementService:
    return AgreementService(AgreementRepository(session, principal.scope), principal)

# app/api/agreements.py
@router.get("/{agreement_id}", operation_id="getAgreement")
async def get_agreement(
    agreement_id: UUID,
    service: Annotated[AgreementService, Depends(get_agreement_service)],
    _: Annotated[None, Depends(require("agreement:read"))],
) -> AgreementRead:
    return await service.get(agreement_id)
```

Services depend on repository **protocols**, not concrete classes, wherever a second implementation
is plausible — retrieval, storage, notification. Define the protocol next to its consumer.

## SOLID, concretely

- **Single responsibility** — one module, one reason to change. `AgreementService` orchestrates
  agreement lifecycle; it does not render documents, send email, or embed text. If a docstring
  needs "and", split the module.
- **Open/closed** — new contract types, new attribute data types, and new document formats must be
  addable through registration or configuration, not by editing a growing `if/elif` chain. Use a
  registry dict keyed by the discriminator.
- **Liskov** — every implementation of a protocol must honour the same contract, including error
  behaviour. A retriever that returns unscoped results where another filters by scope is a
  substitution failure and a security bug.
- **Interface segregation** — narrow protocols. `SupportsRetrieve` is better than one `RagEngine`
  interface with fifteen methods, most of which each consumer ignores.
- **Dependency inversion** — `services/` depends on abstractions defined in `services/`, and
  `repositories/` and `rag/` provide the implementations. The concrete Azure AI Search client is
  never imported inside a service.

## Avoiding duplication

Before writing a function, grep for it. Most "new" needs already exist:

- Pagination, sorting, and filtering → the shared repository base, not per-entity reimplementation.
- Record-scope filtering → `ScopedRepository`, applied once, never copied.
- Audit emission → the service base helper, never inline `session.add(AuditEvent(...))`.
- Error translation → the global exception handlers, never per-router `try/except HTTPException`.

Three occurrences of the same shape is the threshold for extraction. Two is a coincidence; do not
build an abstraction on it.

## Async discipline

Everything on the request path is `async`. Never call blocking I/O directly in a coroutine — no
`requests`, no `time.sleep`, no synchronous SDK client. If a library is sync-only, wrap it in
`anyio.to_thread.run_sync`. Long-running work (document ingestion, bulk reindex) does not belong in
a request handler; queue it.

## Type discipline

`mypy --strict` passes. No bare `Any`, no untyped `dict` crossing a layer boundary — pass a Pydantic
model or a dataclass. `# type: ignore` requires a comment explaining why and a linked issue.
