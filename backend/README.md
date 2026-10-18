# Lattice backend

Standalone TypeScript API + worker. Lattice is a working label. The integration contract is **`openapi.yaml`** and **`../src/contracts/api.ts`**. Backend packaging remains separate from the root frontend; deployment and cross-application status are tracked in `../docs/application-delivery.md`.

## Development

Requires Node 22+, npm, Docker Compose (or PostgreSQL 16+ with pgvector), Python 3.11+ for PDF parsing.

```sh
cd /home/omni/Projects/lattice/backend
npm ci
cp .env.example .env
docker compose up -d db
npm run migrate
npm run dev
# second terminal, same directory/environment
npm run worker:dev
```

Default API port **4000**, prefix **`/api/v1`**. `GET /healthz` is liveness, `GET /readyz` checks database schema and worker heartbeat. Runtime loads only `backend/.env`. Supply real Supabase and public OpenAI or Azure OpenAI credentials before using authenticated/AI workflows. Missing integration credentials return `CONFIGURATION_ERROR`; there is no demo fallback. Email transmission also requires explicit `EMAIL_DELIVERY_ENABLED=true`.

Dashboard: Supabase access token in `Authorization: Bearer …`. Widget: opaque session token in the same header (separate public routes); session creation requires an allowed `Origin`. Forward the original Origin through the frontend proxy. The server never uses a workspace ID as authorization. Owner: sources, configuration, invitations, evaluations, publishing and billing. Member: inspect, preview, feedback and handoff. Every asynchronous request returns `202 {data:{jobId,...},requestId}`; poll the matching dashboard or public job endpoint. Mutation requests marked in OpenAPI require an `Idempotency-Key` (8–128 characters). Reusing a key with different input returns 409. Collection endpoints accept `limit` (1–100, default 50) and `cursor` (opaque UUID cursor); conversations additionally accept `q`.

## Environment names

- Required at startup: `DATABASE_URL`, `APP_ORIGIN`, `SUPABASE_URL`.
- Auth: `SUPABASE_ANON_KEY` is required for authenticated operations and verified-email checks. `SUPABASE_SERVICE_ROLE_KEY` is server-only and required only when using production private Supabase Storage; never expose or share it. `SUPABASE_JWT_AUDIENCE` defaults to `authenticated`. Asymmetric JWTs use Supabase JWKS with issuer/audience validation; legacy symmetric tokens are verified through Supabase Auth.
- AI: Set `AI_PROVIDER=openai` with `OPENAI_API_KEY`, or `AI_PROVIDER=azure` with `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, and separate answer/grading/embedding deployment names. `ANSWER_MODEL`, `GRADING_MODEL`, and `EMBEDDING_MODEL` remain the public-OpenAI model names and pricing labels; Azure routes use the deployment variables. Model names and cost limits are configurable assumptions.
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`.
- Email: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DELIVERY_ENABLED` (default false).
- Runtime: `PORT`, `HOST`, `TRUST_PROXY`, `LOG_LEVEL`, `DATABASE_POOL_SIZE`, `MIGRATION_DATABASE_URL`, `PARSER_PYTHON`, `PARSER_ARTIFACTS_PATH`, `PARSER_TIMEOUT_MS`, `WORKER_CONCURRENCY`.
- Spend/limits: `GLOBAL_DAILY_SPEND_MICROS`, `DEFAULT_MONTHLY_SPEND_MICROS`, `ANSWER_RESERVE_MICROS`, `CHECK_RESERVE_MICROS`, `EMBEDDING_RESERVE_MICROS`, `OCR_RESERVE_MICROS`, `AI_INPUT_MICROS_PER_MILLION`, `AI_OUTPUT_MICROS_PER_MILLION`, `GRADING_INPUT_MICROS_PER_MILLION`, `GRADING_OUTPUT_MICROS_PER_MILLION`, `EMBEDDING_MICROS_PER_MILLION`, `MAX_UPLOAD_BYTES`, `MAX_WORKSPACE_STORAGE_BYTES`, `MAX_CRAWL_PAGES`, `MAX_PDF_PAGES`, `MAX_OCR_PAGES`, `TRIAL_WORKSPACES_PER_USER`.
- Tests provision their own disposable PGlite and native embedded PostgreSQL databases under `backend/.test-data/`; no external test/production database URL is used.

Originals are staged as private PostgreSQL bytes, then moved by the worker into a private Supabase Storage bucket using the server-only service-role credential. Tenant/eligibility checks protect downloads and no public object-store URLs are issued. API and workers are stateless after the storage transfer.

## Build / deployment

```sh
npm run typecheck
npm test
npm run build
npm run migrate
npm start
npm run worker
# Complete local stack; supply backend/.env first
docker compose up --build
```

Use the backend directory as the API/worker Docker build context. The root directory is the frontend image context. Run migrations once with a migration role; API/worker use a non-superuser, non-BYPASSRLS database role. See `docs/runbook.md` and `deploy/README.md` for role setup, private storage, retention, revocation/backup recovery, provider setup, limits, and Azure Container Apps rollout verification.

## Frontend integration

Configure same-origin forwarding for `/api/v1/**` to port 4000; preserve Authorization, Origin, Referer, Idempotency-Key, multipart bodies and Stripe raw payloads. Hosted iframes send the optional `parentOrigin` at session creation; see the runbook's iframe-origin rules. Do not cache authenticated/public session API responses. Use Supabase signup/login on the frontend; bootstrap creates no implicit workspace. Handle error envelopes and terminal failed jobs. Queue acceptance is not email delivery. Use polling to show import/evaluation/answer progress; no streaming contract in v1. All billing redirect URLs are server-derived from `APP_ORIGIN`.

The root frontend has its own dependencies and Docker image; keep backend credentials out of its bundle. See `docs/verification.md` for backend verification and outstanding live provisioning.
