# Architecture

Status: Backend architecture remains the canonical target below. The frontend/API relay and iframe widget are implemented; see [frontend delivery](frontend-delivery.md) and [verification](frontend-verification.md). Live-provider and backend architecture verification are separate gates, not inferred from frontend tests.

## Stack

Use a modular monolith and background worker.

| Component | Recommendation |
| --- | --- |
| Dashboard and API | Implemented Next.js/TypeScript frontend + restricted server relay to separately packaged backend on port 4000 |
| Widget | Implemented small vanilla-JS embed loader + React/TypeScript support UI in an isolated iframe; Preact remains an optional size optimization, not a second engine |
| Jobs | Node.js worker and pg-boss |
| Parsing | Python + Docling, invoked by the worker |
| Database | Managed PostgreSQL, pgvector, full-text search |
| Auth/storage | Supabase |
| Database access | Drizzle and explicit tenant-scoped queries |
| Answer model | Pinned GPT-4.1 mini snapshot as initial costed baseline; validate quality before launch |
| Embeddings | text-embedding-3-small |
| Offline grading | Bounded GPT-4.1 calls plus human review |
| Billing/email | Stripe if available to the merchant; transactional email provider |
| Hosting | Docker frontend/API/worker on Azure Container Apps; Supabase in a nearby region |
| Monitoring | Structured logs, Sentry, application-level usage records |

The Python parser can be a worker subprocess. Do not create a public parsing microservice initially. Use a direct/session-pooled database connection appropriate to the job library's requirements.

```text
Dashboard / visitor widget
           |
     Next.js / Node API
           |
     +-----+-------------+
     |     |             |
 Postgres  Object store  AI APIs
 +vector
     |
 Job queue -> Node worker
              |- Crawl / parse via Python
              |- Embed / stage source versions
              |- Compare / run checks
              |- Check source changes
              `- Send notifications
```

## Main entities

- workspaces, memberships
- agents, agent_releases
- sources, source_versions, chunks, release_sources
- conversations, messages, retrieval_traces
- feedback, escalations
- eval_cases, eval_runs, eval_results
- usage_events, subscriptions

All tenant-owned entities include workspace_id. Use composite constraints and row-level policies where appropriate. Normal request handling must not casually bypass tenant protections through an unrestricted service role.

### Implemented frontend boundary

`src/lib/api.ts` imports `src/contracts/api.ts`. `src/app/api/v1/[...path]/route.ts` forwards only bootstrap/workspace/public API namespaces using server-only `BACKEND_API_ORIGIN`. Supabase dashboard bearer tokens and opaque visitor bearer tokens are separate. The relay strips cookies, does not follow redirects, and disables caching. The frontend has no retrieval, publication, billing, job-processing or localStorage-backed business-state implementation.

Resource invalidation is workspace-scoped and aborts stale reads; session/client identity changes immediately hide old data. Durable 202 jobs are polled with bounded waits, never reported as completed at acceptance. Source/settings editing uses atomic revision checks; installation records are observations, not browser-authentication claims.

## Ingestion

1. Fetch selected public domains/paths or receive uploads. Bound file/page size, time, and concurrency. Prevent crawler access to private networks and metadata services, including redirects and resolved addresses.
2. Extract main HTML content, headings, and tables. Parse PDFs with page/layout references. Apply bounded OCR where needed; expose uncertain or partial extraction.
3. Preserve originals privately. Normalize boilerplate, deduplicate, record authority/active status, and hash content.
4. Create heading-aware chunks, initially 400–800 tokens, preserving table and parent context. Store source-version and page/section references.
5. Index lexical terms and embeddings. Lexical matching is important for exact product names and error codes.
6. Stage source versions in a draft release. Failed jobs cannot partially change published knowledge. Make retries idempotent by tenant/source/version or content hash.
7. Run selected checks and publish by atomically changing the active release.

Docling reference: https://docling-project.github.io/docling/

## Answer flow

1. Validate agent/visitor session, rate limits, quotas, and spend budget.
2. Resolve the active release at the start of the turn; record it with the response.
3. Use bounded conversation context; optionally rewrite an ambiguous follow-up query.
4. Search lexical and vector indexes, combine ranks, filter archived/deleted/held sources, and apply explicit authority rules.
5. Select a small evidence set within a context budget.
6. Generate a cited answer, clarification, or handoff. Start with one bounded generation path, not a recursive agent loop.
7. Render citation links from allowed source IDs. A citation's existence does not prove entailment.
8. Record evidence, disposition, model/prompt version, token counts, latency, and usage.

Source authority is explicit precedence, not a guarantee of truth. Retrieval similarity and model-stated confidence are not calibrated correctness scores. Old conversation content must not override current source evidence.

## Versioning and deletion

A release references immutable source versions and agent configuration. Rollback changes the release pointer. Deletion/revocation is a separate eligibility restriction applied across releases, so rollback cannot restore deleted knowledge.

Check source eligibility again before delivering evidence/asset access when revocation may have occurred during generation. Citation assets must respect active eligibility rather than expose permanent unrestricted storage URLs.

## Evaluation

- Deterministic: valid/eligible citations, tenant separation, expected structured values where applicable.
- Model-assisted: claim support, completeness, contradiction, appropriate clarification/handoff.
- Human: business correctness, all critical cases, disputed results.

Record release, model snapshot, prompt version, evidence, expected facts, rubric, and result. Keep imported conversations out of training knowledge unless an owner deliberately promotes a cleaned answer. Freeze holdouts before tuning.

Saved checks link to their supporting sources. Update jobs rerun affected checks and controls, but acknowledge dependency detection is incomplete. Never modify expected facts silently to improve scores.

## Operations

- Separate staging and production; run long jobs outside request lifetimes.
- Bind widget sessions to agent and visitor. Origin allowlists alone do not authenticate visitors or protect private data.
- Keep source knowledge suitable for public customer answers; private per-customer retrieval is excluded from MVP.
- Treat crawled content and conversations as untrusted data, not runtime instructions.
- Use server-side provider credentials, per-tenant/global spending caps, bounded retry policies, and idempotent billing.
- Preserve previous published releases during processing failures.
- Escalation delivery has pending/sent/failed states; record failure and permit retry without duplicate tickets.
- Proposed transcript retention: 30 days, with export and deletion controls. Define backup expiry and restore-time deletion handling before launch.
- Back up the database and verify restoration. Redact sensitive conversation content from operational logs.

Performance targets and release tests are defined in delivery-plan.md; quotas and cost assumptions are defined in pricing-and-unit-economics.md.
