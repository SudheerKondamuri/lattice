# Backend implementation and verification receipt

Date: 2026-10-07. Scope: `backend/**` and `src/contracts/api.ts`. No paid resources were provisioned, no real customer email was sent, and no production database was accessed.

## Delivered surface

- `openapi.yaml`: 42 path groups, with request schemas and generated shared response schemas (71 component schemas). `src/contracts/api.ts` is dependency-free and browser-safe.
- Dashboard API: bootstrap/workspace creation, memberships/invitations, sources/uploads/reprocessing/private originals, draft preview, searchable conversations/export/deletion, feedback and handoff/retry, evaluation imports/cases/runs/human verdicts, immutable release snapshots/checks/publish/rollback, settings, usage, Stripe checkout/portal, notifications and durable job status.
- Widget API: origin-bound opaque sessions, conversation continuity, answers, feedback, handoff, session-scoped jobs and cited private assets. Hosted iframe `parentOrigin` is optional and additive.
- Infrastructure: PostgreSQL/pgvector/full-text migrations, FORCE RLS, composite foreign keys, modular API and worker, fenced durable jobs and pipeline steps, private Supabase Storage adapter, daily maintenance/retention, structured redacted logs, health/readiness, Docker/Compose, Azure Container Apps template, migration/runtime role separation, setup/runbook.

## Commands actually run

All commands below ran from `backend/`.

| Command | Observed result |
| --- | --- |
| `npm run build` | Passed; TypeScript output plus parser/migration deployment assets |
| `npm run typecheck` | Passed, including strict and unused-local/parameter checks |
| `npm run lint` | Passed; all targeted code/config/contracts use Prettier formatting |
| `npm run test:coverage` | **68 tests passed**, 5 files, no skipped tests; latest full run 26.57 seconds |
| `npm run test:parser` | **3 Python tests passed**: actual XLSX extraction, invalid XLSX rejection, encrypted PDF rejection |
| `npm run check:contract` | OpenAPI validated: **42 paths, 71 schemas** |
| `npm audit --omit=dev` | **0 known vulnerabilities** in installed production npm dependencies |
| `docker compose config --no-env-resolution --no-consistency --quiet` | Passed static Compose validation |
| `python3 -m py_compile parser/parse.py parser/test_parser.py` | Passed Python syntax check |

Latest V8 coverage: **90.43% statements/lines**, **92.12% functions**, **80.58% branches**. Entry-point scripts and declarative Drizzle schema are excluded from this runtime coverage report. Coverage is not a proof of business-answer correctness or live-provider availability. Python dependencies and operating-system packages are not included in the npm audit result.

### Database isolation

`tests/helpers.ts` creates a fresh in-memory **PGlite PostgreSQL database with the pgvector extension**, applies the actual Drizzle migration, and runs tenant queries using a non-superuser role with FORCE RLS. This verifies SQL constraints, vector/lexical retrieval, snapshots, deletion and application workflows without touching a shared database.

`tests/native-concurrency.test.ts` additionally starts a disposable **native PostgreSQL 18.4** instance on loopback port 55439, using the exact production ledger-table DDL and the production `pg.Pool` transaction implementation. Eight real concurrent connections compete for the last reply quota unit: one succeeds, seven fail. Two different workspaces compete for one remaining global spend allocation: one succeeds, one fails. The server and database directory are stopped/removed after the tests. Native pgvector and a complete production deployment were not exercised by those ledger tests.

## Guarantees covered by tests

| Guarantee | Evidence |
| --- | --- |
| Cross-tenant reads fail; members cannot perform owner mutations; RLS hides another workspace's rows | `tests/application.test.ts`, tenant/role group |
| Invitations reserve member slots, only matching verified identity bootstrap accepts them, and the owner cannot be removed | Membership/invitation case plus Supabase identity adapter fixtures |
| Malformed/empty imports and unsafe URLs become visible terminal failures while published versions remain intact | Ingestion failure cases |
| DNS results, private/reserved addresses, redirects, response sizes, compressed responses and timeouts are bounded | `tests/security.test.ts`, network adapter cases |
| Q&A row and website table/URL references survive extraction; truncation is disclosed | Extraction adapter cases and Python XLSX fixture |
| Draft edits cannot change published visitor answers; exact earlier version evidence is retained | Draft/published isolation case |
| Feedback is readable for owner correction and negative-feedback counts, while staff comments and staff-created escalations are withheld from visitor views | Feedback projection case and session-scoped transcript queries |
| Source deletion during a pending model call suppresses its response and completed-reply unit | Pending-deletion case |
| Rollback and draft dependency edits cannot resurrect deleted knowledge; original downloads remain private and revocable | Rollback, dependency snapshot, private-asset cases |
| Draft-only dependency edits cannot invalidate a published release; published eligibility uses release-frozen dependency edges | Published-release dependency regression |
| Release/source-version/chunk snapshots cannot be mutated or extended later; publish failure rolls back atomically | Immutability and publication atomicity cases |
| Approved evidence wins over lower-authority candidates; unsupported questions become actionable handoffs | Authority and unsupported-question cases |
| A system fallback after invalid citations does not consume a customer reply unit | Invalid-citation regression case |
| Reply persistence, the completed job marker and usage settlement commit together before worker acknowledgement | Atomic reply-completion case |
| Retried turns reuse the same job and charge once; quota/spend/trial limits and stranded reservations behave explicitly | Metering cases and native concurrency tests |
| Expired worker leases fence stale writes and expose failed imports | Worker lease case |
| Queue acceptance is not email delivery; ambiguous delivery retries preserve the provider idempotency key | Escalation retry case and email transport fixtures |
| Raw Stripe webhook signatures are verified; replay is deduplicated; older state is ignored and canonical state is refetched | Stripe signature/inbox and subscription fixtures |
| Historical baselines and facts are stored, holdouts freeze, development revisions are explicit, and human verdicts are persisted | JSON/CSV evaluation cases |
| Maintenance creates a reviewed candidate/check cycle; check exhaustion blocks automatic publication; scheduling batches once per day | Maintenance cases |
| Retention erases transcripts and revokes session access | Daily retention case |
| UTF-8 input and JSON-escaped prompt size are bounded before paid calls; missing AI configuration consumes no provider budget | Context-bound regression and configuration-failure cases |
| Azure OpenAI deployment routes use `api-key`, separate chat/embedding deployment names, and never send the Azure credential as a browser/public OpenAI credential | Azure transport adapter fixture |

## Regression evidence and transferable lessons

Journeys were derived from the user's backend requirements and `docs/delivery-plan.md`. Tests include synthetic provider transports only in `tests/`; runtime code has no demo/mock mode. This was not a claim of a complete test-first history: initial missing-implementation tests and the specific regressions below have observed RED/GREEN evidence.

1. **Immutable snapshots must include dependency edges.** A test initially returned `answer` instead of the expected `handoff` after a draft dependency was removed and its original supporting source deleted. The cause was resolving a published approved answer through mutable draft dependency edges. Releases now snapshot those edges and eligibility rechecks consult them. Next time a snapshot protects content through a mutable relationship, freeze the relationship too. Signal: editing a draft relationship changes the meaning or eligibility of a historical snapshot. See `releases.ts`, `answers.ts`, and the dependency regression.
2. **Async acceptance and completion are distinct contracts.** A source-edit test initially received HTTP 200 instead of 202. Answer review also identified a crash window between persisted/charged output and a later worker success marker. Accepted async mutations now return 202, and replies commit their result, usage and terminal job state together. Next time an outbox/worker operation charges for completion, test a crash before acknowledgement and identify the single authoritative completion transaction. Signal: the UI can report failure while a charge or durable result already exists.
3. **Attempted AI output is not necessarily a billable answer.** The invalid-citation regression initially recorded one reply unit when the delivered response was a system fallback. A separate `aiAuthored` delivery decision now governs reply settlement. Next time a generated response is replaced during validation or revocation, meter the final delivered disposition rather than the attempted model call. Signal: rejected output still retains a model name or token receipt.
4. **Character limits are not token/spend limits.** A hostile UTF-8/escaped-text fixture initially reached the outbound adapter before a bounded-input rejection. Byte-aware embedding batches and a serialized generation-request limit now bound the actual provider input; reservations use that conservative token ceiling. Next time a provider budget is derived from text length, include UTF-8 bytes, JSON escaping and message overhead. Signal: non-ASCII or control-heavy input costs much more than the same character count of ordinary English.

The Drizzle migration test also found missing statement breakpoints: raw PostgreSQL `exec` accepted a multi-statement migration that PGlite's prepared migration path rejected. The migration now has explicit Drizzle statement separators and is tested through the migration runner.

## Remaining provisioning and staging verification

These are **not verified live integrations**:

1. Configure a real Supabase project, verified-email authentication, and production PostgreSQL roles/TLS. Synthetic JOSE/Supabase response fixtures validate the adapter logic, not that project's deployment settings.
2. Supply OpenAI credentials and collect actual token/cost/latency receipts on representative held-out customer questions. Review critical cases with humans; no superior-accuracy or p95 claim is supported by these tests.
3. Configure Stripe recurring prices, portal and webhook endpoint, then collect test-mode checkout/subscription/webhook receipts. Configure Resend sender identity and obtain authorization before an actual sandbox/customer send.
4. Build the Docker image on a host with a working daemon and run the full Docling layout/table/OCR fixtures with downloaded model artifacts. Local Python verification covered XLSX and encrypted-PDF rejection; complete PDF/OCR conversion and parser resource limits still need empirical staging validation.
5. Configure encrypted backups, retention and restore-time revocation replay, then perform a restoration drill. The runbook describes this policy; no managed backup infrastructure was provisioned.
6. Run the full application against isolated live staging: real API forwarding, Supabase flows, async polling, hosted-iframe origin handshake, signup-to-publish, private Storage, Azure receipts, Resend sandbox delivery and billing test-mode events. Frontend fixture verification is recorded separately in `../../docs/frontend-verification.md`.

## Delivery self-evaluation

Overall **4.1/5** against the delivered backend work, not a product accuracy score.

| Axis | Score | Evidence and improvement |
| --- | --- | --- |
| Accuracy | 4 | Build, migration, SQL constraints and 68 tests pass; full Docling/live provider behavior still needs external receipts. |
| Completeness | 4 | The requested API/worker/database/frontend integration and deployment surfaces are implemented; image/PDF/OCR, real provider setup and backup restoration remain staging work. |
| Clarity | 4 | Contracts, environment names, limits and runbook are concrete; the broad API remains a large routing module that could be split by resource in a future maintainability pass. |
| Actionability | 4 | Local commands, isolated tests and deployment assets are provided; startup needs operator-supplied provider configuration and an available Docker/PostgreSQL host. |
| Conciseness | 4 | The final handoff can be brief while this receipt preserves detail; generated OpenAPI and operational documentation are necessarily substantial. |

Highest-impact improvement: complete the Docker/Docling fixture run and authorized staging provider receipts, then perform a backup restoration drill. The application is locally verified and deployable by configuration, but not yet provisioned or production-verified.
