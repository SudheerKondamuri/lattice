# Delivery plan

Status: Frontend implementation is in progress with service-wired dashboard/widget flows and isolated verification; existing source/settings editing and automatic installation verification remain contract-blocked. Backend/live-provider readiness is not inferred. See [frontend delivery](frontend-delivery.md) and [actual checks](frontend-verification.md). The original eight-week sequence below is a planning target, not a measured delivery claim.

## Sequence

| Week | Deliverable |
| --- | --- |
| 1 | Auth, tenant model, one URL → extracted source → cited answer |
| 2 | Crawling, parsing, source inspection, bounded OCR |
| 3 | Widget, transcripts, feedback, email handoff |
| 4 | Source versions, corrections, saved checks, publication, rollback |
| 5 | Evaluation imports, Chatbase export compatibility, comparison UI |
| 6 | Scheduled changes, maintenance queue, billing, quotas, cost instrumentation |
| 7 | Two or three customer pilots; fix retrieval/onboarding failures |
| 8 | Reliability, acceptance verification, documentation, launch polish |

Recruit pilots while implementing. Protect the complete correction/comparison/deployment loop. Cut optional import formats and visual enrichment before cutting that loop.

## Required release criteria

All verification uses staging, synthetic/redacted data, or explicitly authorized pilot material. Frontend unit/component and isolated browser checks have been run; their exact scope/results are in [frontend-verification.md](frontend-verification.md). The criteria below remain end-to-end backend/live-staging release gates; fixture passes do not satisfy authorization, extraction, email delivery, payment, AI-quality or production-performance claims.

| ID | Starting condition / action | Observable outcome and prohibited side effect | Evidence |
| --- | --- | --- | --- |
| AC-01 | Import a supported mixed corpus | Every source reaches a visible terminal state; partial extraction is disclosed rather than marked wholly ready | Integration fixtures and manual extraction inspection |
| AC-02 | Query/read/export from two distinct workspaces | No cross-tenant knowledge, conversation, evaluation, or asset disclosure | Automated authorization tests |
| AC-03 | Inject failure during a source update | Previous published release remains usable; no partial new corpus appears | Failure-injection integration test |
| AC-04 | Correct knowledge and publish | New turns use the new release; prior response evidence remains inspectable | End-to-end correction/publication test |
| AC-05 | Delete a source and attempt rollback | Source becomes ineligible immediately and cannot be resurrected through rollback | Retrieval, asset-access, and rollback tests |
| AC-06 | Request handoff and retry delivery | One escalation exists; sent/failed delivery status is visible; retries avoid duplicate logical escalation | Email sandbox and retry tests |
| AC-07 | Retry a reply or exhaust allowance | No duplicate charge; quota/spend exhaustion produces an explicit support fallback | Billing/concurrency tests |
| AC-08 | Import historical baseline answers | Dates/context limitations are labeled; losses and ungraded cases remain visible | Comparison fixtures and human UI review |
| AC-09 | Run frozen pilot evaluation questions | Human-reviewed correctness, claim support, and handoff behavior are recorded; all critical cases reviewed | Evaluation report with set/model/release versions |
| AC-10 | Run five simultaneous normal chat sessions | Target p95 completion below 10 seconds with provider quota available; failures remain visible | Staging load test with workload/token budget recorded |

AC-09 is an evidence gate, not permission to market an unreviewed quality score. Agree pilot-specific acceptable error severity and switching criteria before evaluating the holdout. Claim superiority only where the actual comparison supports it.

## Verification strategy

- Unit/integration: parsing boundaries, tenant scoping, source eligibility, publication atomicity, usage idempotency.
- End-to-end: signup → import → preview → compare → embed → feedback → correction → publish → handoff.
- Operational: parser timeouts, provider errors, retries, quota exhaustion, backup restoration.
- Human: source extraction, business correctness, comparison fairness, widget keyboard/mobile usability.
- Economic: measured cost per reply/check/processed page and support time per account.

Use targeted tests with meaningful failure cases. Do not equate passing automated checks with proven answer correctness.

## Decisions to settle during implementation

- Confirm hosting/AI budget and merchant/payment-provider availability.
- Benchmark parser size/time/storage bounds and publish explicit limits before billing customers.
- Confirm model snapshot against representative customer questions.
- Define backup retention/deletion behavior and validate restore-time revocations.
- Measure unit costs before finalizing extra-check packages or changing launch allowances.
- Choose a public brand only after checking existing uses and domains.
