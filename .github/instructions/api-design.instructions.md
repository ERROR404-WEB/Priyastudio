---
description: "Use when adding or changing FastAPI routers and endpoints. Covers REST conventions, operation ids for client codegen, pagination defaults, filtering, sorting, error envelopes, and versioning."
applyTo: "app/api/**"
---

# API design

The frontend generates its entire TypeScript client from this service's OpenAPI document. Schema
quality is not cosmetic — sloppy schemas produce a sloppy client, and unstable operation ids break
their build.

## Routes

```
GET    /api/v1/agreements                 list
POST   /api/v1/agreements                 create
GET    /api/v1/agreements/{id}            detail
PATCH  /api/v1/agreements/{id}            partial update
DELETE /api/v1/agreements/{id}            delete
POST   /api/v1/agreements/{id}/approve    state transition
```

- Plural, lowercase, hyphenated collection nouns.
- `PATCH` for updates. `PUT` implies full replacement and we do not offer it.
- State transitions are sub-resource `POST` actions, never a `PATCH` that sets `status` directly —
  transitions have rules, and a generic update cannot enforce them.
- Nest only one level: `/agreements/{id}/obligations`. Deeper nesting means the child needs its own
  top-level collection.

## Operation ids

Every route declares an explicit, stable, camelCase `operation_id`. It becomes the generated hook
name on the frontend.

```python
@router.get("", operation_id="listAgreements")
@router.get("/{agreement_id}", operation_id="getAgreement")
@router.post("", operation_id="createAgreement", status_code=201)
@router.post("/{agreement_id}/approve", operation_id="approveAgreement")
```

Renaming an operation id is a breaking change to the frontend. Treat it like renaming a public
function.

## Pagination

Every list endpoint is paginated. **Default page size is 10.** Maximum is 100.

```python
class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
```

Query parameters are identical across every list endpoint, because the frontend `DataTable` sends
the same shape everywhere:

`?page=1&page_size=10&sort=created_at&order=desc&q=<search>&<field>=<value>`

- `sort` accepts only an allow-listed set of column names per endpoint. Never interpolate it into
  SQL — map it to a column object.
- Unbounded list responses are forbidden. There is no `?all=true`.
- `total` is a real count. If counting becomes expensive, add a cheaper cursor endpoint rather than
  silently returning an estimate.

## Schemas

- Request and response models live in `app/schemas/`, never inline in the router.
- Declare `response_model` on every route. Never return a bare `dict` — the generated client will
  type it as `unknown`.
- Every field carries a `description`; the frontend surfaces these in generated docs and tooltips.
- Use `Annotated[...]` with constraints (`MinLen`, `Ge`) so validation appears in the schema rather
  than living only in code.

## Errors

One envelope, produced by global exception handlers, following RFC 9457:

```json
{
  "type": "https://zcip.zoetis.com/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "end_date must be after start_date",
  "instance": "/api/v1/agreements",
  "correlation_id": "01J8Z…",
  "errors": [{ "field": "end_date", "message": "must be after start_date" }]
}
```

- Domain exceptions are raised in services and translated centrally. Routers do not build
  `HTTPException` for domain failures.
- `403` when the user lacks the permission. **`404` when the record exists but is out of the user's
  record scope** — a `403` would confirm the record exists, which is itself a leak.
- Never put an exception string, stack trace, or SQL fragment in `detail`. Log those with the
  correlation id instead.
- `correlation_id` appears in every error response and every log line for that request.

## Idempotency and concurrency

- `POST` endpoints that create records accept an optional `Idempotency-Key` header; replays return
  the original result rather than a duplicate.
- Detail responses carry an `ETag`. `PATCH` accepts `If-Match` and returns `412` on mismatch, so two
  users editing the same agreement cannot silently overwrite each other.

## Versioning

`/api/v1` from day one. Additive changes stay in v1. Anything that breaks a generated client —
removing a field, narrowing a type, renaming an operation id — needs v2 plus a deprecation window.
