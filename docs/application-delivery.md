# Full application delivery

## Approved target

Knowledge factory for small B2B SaaS: managed signup → workspace → ingest public customer knowledge → inspect → draft answer → comparison/checks → publish → installed website chat → feedback → correction → recheck → republish/rollback → email handoff. Full repository ownership was authorized by the user. Production target is Supabase Auth/Postgres/private Storage, Azure OpenAI, Azure Container Apps and Resend. Local verification comes first; Stripe stays in explicit pilot mode until configured. Conversation retention defaults to 30 days.

The factory is a durable, bounded ingestion/retrieval/evaluation/publication pipeline with persisted policy controls. No arbitrary workflow graph or autonomous knowledge rewriting is part of the approved scope.

## Acceptance and verification ledger

| ID | Observable requirement | Verification | Current status |
| --- | --- | --- | --- |
| F-01 | Source and settings edits persist; stale revisions are rejected atomically without overwrites | Backend revision tests + browser conflict flow | Implemented; locally verified |
| F-02 | Uploaded originals reach private Supabase Storage; downloads recheck tenancy/eligibility; deletion has durable retries | Storage transport fixtures + deletion tests | Implemented; live bucket pending |
| F-03 | Ingestion exposes fetch/parse/chunk/embed/stage steps and bounded persisted policies; published versions remain intact on failure | Pipeline integration fixtures | Implemented; locally verified |
| F-04 | Azure answer/grading/embedding deployment routing, empty optional env handling and input bounds work independently | Adapter/config regression tests | Implemented; live deployments pending |
| F-05 | Visitor answers identify actual cited passages separately from retrieval traces; source removal and policy holds are rechecked | Deletion/authority/isolation tests | Implemented; locally verified |
| F-06 | Publishing/checks and worker failure updates are fenced; stale work cannot regress newer state or resurrect knowledge | Concurrency/failure injection | Implemented; locally verified |
| F-07 | Dashboard displays observed widget installations, actual usage, feedback and recoverable processing failures | API + browser receipts | Implemented; locally verified |
| F-08 | Complete correction loop works across Next relay, real API, durable worker and isolated PostgreSQL/pgvector | Backend integration + frontend fixture browser tests | Implemented; live-service E2E pending |
| F-09 | Frontend/API/worker deployable images, Azure deployment templates, setup diagnostics and recovery commands are supplied | Builds/static config review | Implemented; image/deployment run pending |
| F-10 | Missing configuration causes explicit failures; no runtime demo providers or fabricated successful delivery | Empty-config/protocol tests + startup checks | Implemented; locally verified |

## External verification boundary

Implementation and isolated verification do not require the operator's credentials. Authorized live staging must subsequently establish actual Supabase confirmation/recovery delivery, Storage permissions, Azure model compatibility/receipts, Resend sender delivery, hosting ingress/secrets and backup restoration. Those are deployment verification steps, not application features left as placeholders. No paid resources, real email or production migrations are authorized by this implementation task.
