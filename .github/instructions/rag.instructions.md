---
description: "Use when working on the RAG pipeline, document ingestion, chunking, embeddings, Azure AI Search retrieval, or AI-generated answers over contracts. Covers the retriever interface, citation requirements, groundedness, and prompt-injection defence."
applyTo: "app/rag/**,app/ai/**"
---

# RAG pipeline

**Skeleton — the detailed pipeline design is a separate exercise.** These are the constraints that
must hold regardless of how the pipeline is ultimately built. Do not treat absence of detail here as
permission to improvise on the rules below.

## Swappable retrieval

Azure AI Search is the current retrieval backend, but no service, router, or prompt builder imports
it. Everything goes through a protocol defined in `app/rag/`:

```python
class Retriever(Protocol):
    async def search(
        self, query: str, *, scope: AccessScope, filters: RetrievalFilters, top_k: int
    ) -> list[RetrievedChunk]: ...
```

`AzureAiSearchRetriever` implements it. A `PgVectorRetriever` must remain a drop-in replacement.
Anything that leaks the concrete client — index names, Azure filter syntax, SDK types — above the
`app/rag/` boundary is a violation.

## Access scope is part of retrieval, not a post-filter

The scope predicate is compiled into the search query itself. Retrieving broadly and filtering the
results afterwards is forbidden: it leaks through relevance scores, result counts, and any summary
computed before filtering.

A user must never receive an answer grounded in a contract they could not open directly. This is the
same scope logic as `ScopedRepository` — share it, do not reimplement it.

## Citations are mandatory

- Every generated answer cites the chunks that grounded it: attachment id, page or section, and the
  quoted span.
- An answer with no retrieved chunks returns "not found in your accessible contracts". It never
  falls back to model world-knowledge about contract law.
- Citations resolve to records the user can actually open — verify before returning, do not assume
  retrieval got it right.
- The frontend renders citations as links; an uncitable answer is a bug, not a UX detail.

## Groundedness

- Run a groundedness check on the generated answer against its retrieved context before returning
  it. Below threshold → return the retrieved excerpts without a generated summary rather than a
  plausible fabrication.
- Keep an eval set of question/expected-citation pairs in `tests/rag/evals/`. CI runs it. A
  regression in retrieval recall or groundedness fails the build.
- Log retrieval metrics (query, top-k ids, scores, latency) with the correlation id — never the
  contract text itself.

## Prompt-injection defence

Ingested contracts are **untrusted input**. A counterparty can put instructions in a PDF.

- Retrieved content is always delimited and labelled as data, never concatenated into the
  instruction section of the prompt.
- System instructions state explicitly that content inside document delimiters is reference material
  and must not be treated as instructions.
- The model has no tools that mutate state during a Q&A turn. Retrieval is read-only.
- Strip or neutralise embedded active content (scripts, macros, embedded links with instructions)
  during extraction, before chunking.
- Never echo raw retrieved text into a system prompt, an error message, or a log line.

## Generic by construction — never code to one document

The corpus is 1000+ legal contracts with no shared template: different counterparties, layouts,
fonts, section numbering, table styles, scanned vs digital pages, and languages. Extraction,
normalisation, and chunking must work on **any** PDF, not the handful used while developing.

- **Never hardcode to a specific document.** No literal filenames, no fixed page counts, no
  "the party name is on page 2", no coordinates or bounding boxes copied from a sample, no magic
  string offsets, no assumption that a heading, clause, or field appears in a known position. If a
  value is derived from inspecting one test PDF, it is a bug.
- **Drive behaviour from the document's own structure**, discovered at runtime — detected headings,
  font/size/weight signals, table geometry, whitespace, reading order from the layout model — not
  from patterns you observed in the samples you were handed.
- **Test PDFs are fixtures, not a specification.** They prove the generic path works on real input;
  they never justify a branch that only makes sense for that file. A `if "Wonderlich" in ...`, a
  page-index constant, or a layout rule tuned to one vendor is the exact mistake this section
  forbids.
- **Prefer configuration and learned/detected thresholds over constants baked into code.** When a
  threshold is unavoidable, it is a named, documented parameter with a rationale — not an
  unexplained number that happens to fit the current sample.
- **Degrade, don't assume.** An unexpected structure (missing text layer, unusual table, no
  detectable headings, an unreadable page) must be handled as a first-class case — flagged for
  review or processed by a fallback — not silently mishandled because it did not match the shape of
  a test file.
- **Every rule must be justified against the whole corpus, not one document.** Before adding any
  branch, ask: "does this hold for an arbitrary contract I have never seen?" If the honest answer is
  "only for the samples", it does not go in.

Reviewer test: could this code produce correct output on a contract with a completely different
layout that no one has looked at? If not, it is overfit and must be generalised.

## Ingestion

- Pipeline stages are separable and individually testable: extract → normalise → chunk → embed →
  index. Each stage takes and returns a typed model.
- Every run is recorded as an `IngestionRun` with status and error detail, so failures are visible
  and reprocessing is idempotent — re-ingesting the same attachment must not duplicate chunks.
- Chunk records carry provenance (attachment id, page, offsets) and the access-scope keys that
  retrieval filters on. Scope keys are denormalised onto the chunk deliberately, so search can
  filter without a join.
- Ingestion never runs in a request handler. It is queued and processed out-of-band.
- Extraction that needs OS binaries (PDF rendering, OCR, DOCX conversion) is why this service ships
  as a container. Declare those dependencies in the Dockerfile, not at runtime.

## Model access

Generation runs on **Langdock**, the Zoetis-internal gateway. It fronts several model families
behind one API, which is why it is preferred over a single-vendor endpoint. Document OCR and layout
are **not** Langdock's job — that stays on Azure Document Intelligence with the UAMI, unchanged.

### The provider is configuration, not architecture

No service, router, or prompt builder imports a model client. Everything goes through a protocol in
`app/ai/`, in the same spirit as `Retriever`:

```python
class FieldExtractor(Protocol):
    async def extract(
        self, document: DocumentText, *, fields: Sequence[FieldSpec]
    ) -> list[FieldCandidate]: ...
```

`LangdockFieldExtractor` implements it. A stub implementation backs the tests — it is the one
legitimate substitution, because the extractor is a boundary, not the thing under test. Anything that
leaks the concrete client — model names, vendor SDK types, wire-format payloads — above the `app/ai/`
boundary is a violation, and would make swapping the gateway a rewrite rather than a config change.

Model identifiers come from configuration and are recorded on every stored result, so an output can
always be attributed to the model that produced it.

### Credentials

Langdock authenticates with an API key. This is a **narrow, deliberate exception** to the
managed-identity rule, and it does not generalise: Azure resources (Blob, Document Intelligence,
Postgres, Key Vault) continue to use `DefaultAzureCredential` with the UAMI, and adding an API key
for any of them is a defect.

The key is a Key Vault reference resolved by App Service into an environment variable and read
through `Settings`, exactly like every other secret. It is never in code, a config file, a container
image, a log line, or CI. It is never returned by an endpoint and never echoed in an error. Rotation
is a Key Vault operation and must not require a redeploy.

### Operational limits

- Token budgets and timeouts are explicit. A slow AI call must not hold a database transaction open —
  call the model outside the transaction and persist the result in a short one.
- Retries cover transient failures only, with backoff and a bounded attempt count. A non-transient
  rejection fails the document rather than being retried into a rate limit.
- `ai:query` permission is required, and AI queries over confidential agreements are audited.

### Extracted values are claims until verified

A model answer is never persisted as fact on a contract record. Every extracted value carries a
verbatim quote and a page number, and the quote must be confirmed to appear literally in that page's
extracted text before the value is stored. A value whose quote cannot be located is discarded as
ungrounded — this is the groundedness rule applied to extraction, and it doubles as the strongest
available defence against instructions embedded in a counterparty's PDF.

Confidence is derived from checks the platform performs — groundedness, type and range validation,
and agreement with independent evidence — never from a model's self-reported score.

A field the document genuinely does not state is recorded as **absent**, which is a distinct outcome
from "not yet extracted" and from "extraction failed". Collapsing the three into one placeholder
hides failures on a legal record; the distinction is preserved in storage and resolved for display
in the UI.
