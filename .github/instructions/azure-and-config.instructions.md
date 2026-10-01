---
description: "Use when working with configuration, environment variables, Key Vault, managed identity, Azure Blob, Redis, Azure AI Search clients, the Dockerfile, or GitHub Actions deployment workflows for the backend."
applyTo: "app/core/**,Dockerfile,.github/workflows/**,docker-compose*.yml"
---

# Azure and configuration

There is no infrastructure-as-code in this repo. Resources are provisioned externally. This file
governs how the application **consumes** them. See `docs/AZURE_RESOURCES.md` for the inventory.

## Configuration

One `Settings` object, Pydantic `BaseSettings`, in `app/core/config.py`. Nothing else reads
`os.environ`.

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZCIP_", frozen=True)

    environment: Literal["dev", "uat", "prod"]
    database_url: PostgresDsn
    storage_account_url: HttpUrl
    search_endpoint: HttpUrl
    azure_client_id: str          # the UAMI
    allowed_origins: list[HttpUrl]
```

- Prefix `ZCIP_`. Names are stable — App Service settings reference them.
- Fail fast: the app refuses to start on a missing or malformed setting. Never `os.getenv(..., "")`
  with a silent default for something required.
- No secret has a default value in code.
- Settings is `frozen=True` and injected via `Depends(get_settings)`, never imported as a mutable
  module global.

## Secrets

- Secrets live in Key Vault. App Service resolves them into environment variables through Key Vault
  references, so the application code sees plain env vars and never calls Key Vault directly.
- Never a secret in source, in `.env` committed to git, in a Dockerfile `ENV`, in a workflow file,
  or in a log line. `.env.example` documents names with empty values only.
- Rotating a secret is a Key Vault operation plus an App Service restart. No redeploy, no code
  change.

## Service-to-service auth

`DefaultAzureCredential` with the user-assigned managed identity, everywhere:

```python
credential = DefaultAzureCredential(managed_identity_client_id=settings.azure_client_id)
blob = BlobServiceClient(settings.storage_account_url, credential=credential)
search = SearchClient(settings.search_endpoint, index_name, credential=credential)
```

- **No account keys, no connection strings with embedded credentials, no SAS built from an account
  key.** Attachment downloads use a *user-delegation* SAS, which is derived from the identity — see
  the security instructions.
- Clients are created once at startup and reused. Creating a credential per request exhausts the
  token cache and adds latency.
- Locally, `DefaultAzureCredential` falls through to Azure CLI login. Local development must not
  require a different code path.

## Resources

| Resource | Purpose | Notes |
|---|---|---|
| PostgreSQL Flexible Server | System of record | Entra auth via UAMI, not a password. TLS required. |
| Blob Storage | Attachments, generated documents | Private containers. Opaque UUID blob names. |
| Azure AI Search | RAG retrieval | Accessed only through the `Retriever` protocol. |
| Azure OpenAI | Embeddings and generation | Deployment names from config. |
| Redis | Cache, rate limits, idempotency keys | Never the system of record. Assume it can be empty at any moment. |
| ACR | Container images | Images are immutable and tagged by commit SHA. |
| Key Vault | Secrets | Consumed via App Service references. |

## Container

- Multi-stage build. Final stage runs as a **non-root** user.
- Pin the base image by digest, not a floating tag.
- OS packages needed for document extraction (poppler, tesseract, LibreOffice) are declared here.
  Never install at runtime.
- `uv sync --frozen --no-dev` in the build stage. The lockfile is committed and authoritative.
- `HEALTHCHECK` hits `/health/live`. `/health/ready` additionally checks database and search
  connectivity and is what App Service probes before routing traffic.
- No secrets in build args or layers. Build context excludes `.env`, `.git`, and test fixtures.

## CI/CD

- GitHub Actions with **OIDC federated credentials**. There is no client secret in GitHub, and
  `secrets.AZURE_CREDENTIALS` must never appear.
- Required permissions block on any deploying job:
  ```yaml
  permissions:
    id-token: write
    contents: read
  ```
- Pipeline order: lint → types → tests → build image → push to ACR by commit SHA → deploy.
- Migrations run as a **separate step before** the new image receives traffic, never on application
  startup. Concurrent instances starting up would race.
- Environments `dev` → `uat` → `prod`, each with its own app registration, Key Vault, storage
  account, and search service. Nothing is shared across environments.
- `prod` requires an environment protection rule with manual approval.
- The image promoted to `uat` and `prod` is the **exact artifact** built for `dev`. Never rebuild
  per environment.
