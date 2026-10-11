# Backend setup and operations

## Implementation boundary

The standalone Fastify API, PostgreSQL schema, SQL/Drizzle migrations, parser subprocess, and durable worker live in `backend/`. Shared browser-safe types live in `src/contracts/api.ts`. This backend uses parameterized SQL for transactions and retrieval, with Drizzle's migration runner. Root/frontend packaging is separate; cross-application delivery is documented in `../../docs/application-delivery.md`.

### Decisions recorded for this implementation

1. **API and worker:** one modular application, two processes. A PostgreSQL `FOR UPDATE SKIP LOCKED` queue implements durable jobs instead of adding pg-boss. Leases are renewed every 15 seconds, expire after 60 seconds, and use a unique fencing token. Work is committed only under the active lease. AI operations do not automatically repeat an uncertain paid call. Website/email retries are bounded; maintenance dependency checks have 30 bounded attempts.
2. **Private originals:** Production originals use a private Supabase Storage bucket (`SUPABASE_STORAGE_BUCKET`) through a server-only `SUPABASE_SERVICE_ROLE_KEY`; browser clients never receive it. During the upload transaction the original is staged in PostgreSQL until the worker stores it, then database bytes are cleared. Both public and dashboard downloads recheck eligibility. Local isolated tests use an in-memory storage transport; production storage operations fail explicitly if the bucket or server credential is unavailable.
3. **Tenant enforcement:** all request resources are scoped to verified memberships; owners make knowledge/configuration/publication/billing changes, members can inspect/preview/hand off. Tenant transactions set a local workspace context and lock the workspace row. FORCE RLS and composite foreign keys provide another boundary. System context is restricted to explicit auth/bootstrap, session lookup, queue/scheduler and webhook code paths. This is application-enforced context, not a claim that an unrestricted SQL client can safely possess the runtime database password.
4. **Publication:** a release freezes configuration, source versions, authority and dependency edges. Database triggers prevent mutation or later extension of release snapshots. Source versions are immutable except deletion redaction. Publishing and rollback are atomic pointer switches with an expected-current-release precondition and an audit record of checks/warnings. Revocation is independent of the release pointer.
5. **Checks:** cases retain baseline timestamps, context, expected facts, source dependencies and development/holdout split. Run inputs are frozen snapshots. Holdouts become immutable on their first run; owners can explicitly revise development cases with optimistic revision checks. Exact normalized duplicate questions cannot cross splits; semantic near-duplicate detection remains a human dataset review responsibility. Expected-fact matching is lexical, preliminary model support grading is labeled, and critical cases need human verdicts.
6. **Maintenance:** daily UTC scheduling, changed-content detection, unchanged-chunk embedding reuse, affected/source-free/critical/control checks and one dashboard notification batch per workspace/day. Notifications are persisted in the dashboard; this version does not email maintenance digests. Initial publication is manual. Automatic publication requires owner opt-in, passing checks, no critical unreviewed cases, no stale draft, and an unchanged baseline release pointer. Ordinary noncritical model-checked cases may remain human-unreviewed under that explicit policy. Changed approval-required sources stay withheld until an owner publishes their current replacement. Exhausted checks or incomplete coverage pause auto-publication.

## Local startup

```sh
cd /home/omni/Projects/lattice/backend
npm ci
cp .env.example .env
# Set real Supabase configuration in backend/.env.
docker compose up -d db
npm run migrate
npm run dev
# Second terminal:
npm run worker:dev
```

The development Compose database initializes `lattice_admin` for migrations and `lattice` as a non-superuser, non-BYPASSRLS runtime role. Passwords in Compose are local-only fixtures; the database binds to localhost. If using an existing development volume created with different roles, migrate its roles explicitly instead of assuming initialization SQL runs again. Do not discard an existing volume containing user work.

`DATABASE_URL` is the runtime connection. `MIGRATION_DATABASE_URL` is optional but recommended and overrides the connection only for migrations. Use a direct or session-pooled PostgreSQL connection. Enable pgvector using the migration role. Production must use independently generated credentials and TLS; do not deploy the development Compose passwords.

### Production database roles

Create a migration owner and a separate LOGIN role without superuser/BYPASSRLS. Grant runtime USAGE on the application schema; grant SELECT/INSERT/UPDATE/DELETE on application tables and EXECUTE on application functions. Set default privileges for the migration owner as demonstrated by `deploy/local-roles.sql`. The migration owner needs permission to install pgvector and create the Drizzle migrations schema. Keep the application schema out of Supabase's public Data API exposure; browser clients use Supabase Auth and this API, not direct table queries. A staging query of `pg_roles.rolsuper` and `rolbypassrls` must show false for the runtime role.

### Python parser setup outside Docker

```sh
python3 -m venv .venv
.venv/bin/pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r parser/requirements.txt
.venv/bin/docling-tools models download -o .test-data/docling-models layout tableformer rapidocr
```

Set `PARSER_PYTHON` to the absolute `.venv/bin/python` path and `PARSER_ARTIFACTS_PATH` to the downloaded models directory. Build-time model downloads are public dependencies, not paid AI calls. Runtime PDF conversion is offline with remote services disabled. XLSX requires openpyxl; PDF preflight requires pypdf; layout/table extraction requires Docling models and bounded RapidOCR. Missing dependencies/models cause a visible parser failure. Do not enable runtime model downloads to disguise setup failures.

The backend Docker image builds CPU PyTorch and downloads layout/table/OCR artifacts in advance. It uses the same image for API and worker. The root Dockerfile builds the Next.js frontend separately. Start the migration command once, then the two backend processes:

```sh
docker compose up --build
# A platform deployment uses backend/ as its build context and these commands:
node dist/backend/src/migrate.js
node dist/backend/src/server.js
node dist/backend/src/worker.js
```

The Docker daemon was unavailable in the implementation environment. The image, Bicep deployment and full Docling conversion still require staging build/fixture verification; see `verification.md` and `../deploy/README.md`.

## Provider provisioning

- **Supabase:** create/configure an Auth project, allow the dashboard callback origin, enable email confirmation, set `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Create a private Storage bucket named by `SUPABASE_STORAGE_BUCKET` and set server-only `SUPABASE_SERVICE_ROLE_KEY`; verify public access is disabled. ES256/RS256 JWTs are checked against the project's JWKS, issuer and audience; verified-email status is checked via Auth. Legacy HS256 projects use Auth's user endpoint for server-side token verification. Never pass service-role credentials through the shared contract.
- **OpenAI or Azure OpenAI:** choose `AI_PROVIDER=openai` for the public API with server-only `OPENAI_API_KEY`, or `AI_PROVIDER=azure` for Azure's deployment API. Azure requires the resource endpoint (for example `https://resource.openai.azure.com`), server-only `AZURE_OPENAI_API_KEY`, an API version such as `2024-10-21`, and three deployment names: `AZURE_OPENAI_ANSWER_DEPLOYMENT`, `AZURE_OPENAI_GRADING_DEPLOYMENT`, and `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`. The adapter sends Azure's `api-key` header and deployment URL; it never sends the Azure key to the browser. Ensure the deployments support chat completions and 1536-dimensional embeddings. Missing keys/deployments fail explicitly. Generation is one bounded request; no recursive tool/agent loop. Set account-side provider budget alerts/caps in addition to application limits.
- **Stripe:** create two recurring prices and configure their IDs. Set the API key and webhook signing secret; subscribe the raw `/api/v1/webhooks/stripe` endpoint to `customer.subscription.created`, `.updated`, and `.deleted`. Signature verification precedes processing. The serialized, replay-deduplicated inbox refetches canonical subscription state to handle delayed and same-second events. Customer IDs and configured price IDs determine entitlements; checkout input cannot choose an arbitrary price/customer. Configure the hosted billing portal separately. No purchase or price provisioning was performed by the agent.
- **Resend:** verify a sender domain and configure `RESEND_API_KEY`/`EMAIL_FROM`. Keep `EMAIL_DELIVERY_ENABLED=false` until explicitly authorized to send. Queued delivery is `pending`, provider-confirmed acceptance is `sent`, and failures remain visible. “Sent” means a provider accepted the email, not proof that a human read it or that it reached the inbox.

## Bounds and metering

Defaults are conservative implementation limits pending representative parser, latency and economics benchmarks:

| Operation | Default bound |
| --- | --- |
| Uploaded original | 10 MiB (configurable up to 20 MiB) |
| Workspace knowledge storage | 100 MiB of originals, extracted versions, chunk text/vector estimates and pending imports |
| Sources | 1,000 records excluding deleted sources; plan page allowance also applies |
| Crawl | 50 visited URLs; 90 seconds total; same origin; 4 redirects per fetch |
| Page fetch | 2 MB; 15 seconds including DNS; identity encoding only |
| Extracted source | 1 million characters; 256 chunks of at most 2,400 characters, with overlap |
| PDF | First 100 pages; scanned detection over first 10 pages; OCR capped to first 10 pages |
| Parser process | 120 seconds wall time; 110 seconds CPU; 4 GiB address space; one compute thread |
| XLSX | First sheet; question/answer columns; 2,000 rows; 30 MiB total uncompressed ZIP entries |
| Q&A CSV | question/answer headers; 2,000 nonempty rows; 20,000-character records |
| Evaluation import/run | 500 cases per run/import; 5,000 saved cases/workspace; expected facts are explicit arrays; CSV uses JSON in expected_facts |
| Question/history/evidence | 4,000 / 6,000 / approximately 14,400 characters; encoded AI request capped at 64,000 bytes |
| Embeddings | 8,000 UTF-8 bytes/input; 128,000 bytes and 64 inputs/batch |
| Answer/grading generation | 800 / 500 maximum output tokens; 45-second provider timeout |
| Visitor/preview rate | 20 queued turns/minute/session or workspace respectively; one pending turn per conversation |
| Handoff rate | 20 per workspace/hour from public sessions |
| Visitor sessions | 7-day expiry; 10 creations/minute/IP hash/agent and 1,000/minute/agent |
| Conversation retention | 30 days by default; owner can lower to 1–30 days |

Mixed scanned/digital PDFs whose first ten pages are digital may have later scanned pages with empty extraction. These are flagged for review; page/OCR limits and parser failures are visible rather than marked fully ready. Large documents should be split and inspected. Public crawling does not execute JavaScript or bypass access controls; sitemap/location fetching stays within the selected origin.

Source pages use URL/PDF page counts; text/Q&A use a disclosed 6,000-character approximation. Storage accounting is a conservative logical bound, not the exact PostgreSQL disk footprint. Retained revisions consume the same storage limit until their source is deleted.

Monthly allowance units and spend reservations are transactional. Customer AI-authored answers/clarifications consume reply units after persistence; template handoffs, revoked outputs and failed turns do not. Checks consume a unit for a completed case; reruns are separate operations. Retry keys refer to the same durable job. Queries, embedding batches and OCR are also spend-budgeted. An unknown provider outcome conservatively consumes its reserved budget but no completed reply; a known missing-configuration failure consumes no provider budget. Expired worker reservations are reconciled after 15 minutes. This sacrifices automatic retries after ambiguous AI failures to avoid unbounded duplicate spending.

`spentMicros` is an application budget estimate derived from token receipts and configured cost assumptions, with conservative reserves for ambiguous outcomes and estimated embedding/OCR costs. It is not a provider invoice or a measured unit-economics claim. Defaults include a $5 global daily budget and $10 workspace period budget. The reply/check reserve is raised automatically when configured token-price bounds exceed it. Stripe prices are configured externally. Automatic overage purchases are prohibited by a database constraint.

## Deletion, evidence, backups and restoration

- Deleting a source immediately tombstones it, removes chunks/original bytes, redacts extracted versions, cancels pending ingestion, and increments the draft revision. It cannot be restored. Archival is reversible but immediately excludes retrieval. Rollback cannot clear a tombstone or an approval hold.
- Release IDs, version hashes, authority/dependency snapshots and prior answer evidence are audit history. A source deletion rechecks/redacts previously generated visitor output and every asset access. Owner-visible prior evidence is also projected through eligibility checks. Already delivered material in a visitor's browser or email cannot be recalled.
- Conversation deletion erases messages, feedback, sessions, escalation contacts/payloads and answer-job payload/results. Daily retention applies the same deletion operation. Evaluation cases and frozen run snapshots are owner-managed business review records, not automatically ingested training data.
- Backups contain historical personal data and revoked material until the provider's backup retention expires. **Operational policy to configure before launch:** encrypted daily backups, a documented retention period (proposed 7 days), restoration drills, and deletion/hold replay before reopening traffic. These managed backup settings were not provisioned or tested here.
- Export a current tombstone/hold manifest from `sources` to an operator-controlled recovery location before any restore; protect it as tenant metadata. Restore into an isolated database, reapply all later tombstones/holds and transcript deletions, run migrations and isolation/deletion tests, and then change routing. If the latest deletion manifest cannot be recovered, keep the restored service closed. Never make an old backup public and hope rollback filters can reconstruct subsequent deletions.

## Incident procedures

- **Readiness fails:** verify database connectivity/migrations and a worker heartbeat newer than 90 seconds. Liveness only reports that the API process runs. Restart a worker after configuration repair; leases allow safe takeover.
- **Import fails:** inspect the job's sanitized error and source warnings. The prior release remains active. Correct the URL/file/provider configuration and request an explicit reprocess with a new idempotency key. No partial corpus is promoted.
- **Checks or auto-publication pause:** inspect the candidate's check report, unreviewed critical cases, source holds and usage. Owner review can explicitly acknowledge warnings for a manual publish; expected facts are never adjusted automatically.
- **Email is ambiguous:** retry the same escalation, preserving its provider key and frozen payload. Resend's deduplication window is treated as 24 hours; after 23 hours this backend refuses another automatic send and asks for receipt reconciliation. Do not reset the key to force a potentially duplicate ticket.
- **Spend exhausted:** the job fails with quota/spend details and the widget retains its support-email fallback. Adjust a configured cap deliberately or use subscription management. No background job buys allowance.
- **Logs:** JSON logs contain request IDs/status/error codes, not authorization headers, bodies, transcript text, source bodies, email addresses or provider payloads. Correlate an API request ID with the returned job ID; inspect content only through authorized application views/database operational access.

## Frontend handoff

Use the OpenAPI file and shared types, not localStorage-backed substitutes. Forward `/api/v1/**` to port 4000, preserving Authorization, Idempotency-Key, Origin, Referer, multipart boundaries and Stripe raw bodies. APIs send `Cache-Control: no-store`; proxies must preserve this.

Behind a trusted reverse proxy, set `TRUST_PROXY` to that proxy's IP/CIDR list (comma-separated, or `loopback` for a local proxy) and have it replace untrusted forwarded-IP headers with the verified client chain. The default `false` counts the directly connected IP; without configuring this, clients behind one proxy share a session-creation rate bucket.

For a hosted iframe, call `POST /public/sessions` from `APP_ORIGIN` with `parentOrigin` obtained from a validated parent-window message. The backend checks that the real request came from `APP_ORIGIN` and that the claimed parent is allowed, records an installation observation, and returns an opaque visitor token. Origin allowlists are abuse controls, not proof of visitor identity. Persist the token within widget-owned storage; use it on public requests and never share it across visitors. Same-origin GETs commonly omit Origin, so preserve Referer. A direct caller can instead use its actual allowed Origin without `parentOrigin`. The iframe must verify `postMessage` event origins; the server cannot prove a browser's embedding ancestry from a claim alone.

Poll dashboard/public job endpoints and distinguish queued/running/succeeded/failed. A successful answer job returns `Answer`, an ingestion job returns `SourceDetail`, a check job returns `{runId}`, and a handoff job returns delivery status. Render answer text safely; build citations from evidence IDs/validated URLs. Private asset downloads require authenticated `fetch` and a blob URL; a bare anchor cannot supply the bearer token. Publication requires `expectedPublishedReleaseId` and an explicit warning acknowledgement. Backend paths and payloads are stable; `parentOrigin` is an optional additive field. Root frontend packaging uses its own Dockerfile and `BACKEND_API_ORIGIN`; keep the backend out of the browser bundle.
