# Frontend verification and configuration

Date: 2026-10-07. Scope: frontend + same-origin relay + public widget. All browser mutations use isolated test doubles and synthetic accounts/data. No production payment, customer email, real AI request or private customer corpus was used.

## Recorded checks

| Command | Actual result | Scope / limitation |
| --- | --- | --- |
| `npm run typecheck` | PASS (strict TypeScript; unused locals/parameters enabled) | Frontend, shared contract consumption, frontend tests/config only; backend packaging excluded |
| `npm run test:coverage` | PASS: 95 tests / 8 files | API operation mappings/errors, tenant resource isolation/invalidation, rendering/evidence, modal focus restoration, public storage/pending-job receipts, relay boundaries |
| Coverage from that run | 94.03% statements/lines, 87.90% branches, 97.18% functions | Explicitly scoped to `api.ts`, `forward.ts`, `presentation.ts`, `widget/storage.ts`. This is **not** whole-application/component/E2E coverage. Thresholds 80% are enforced for this scope |
| `npm run build` | PASS, Next.js 16.3.8 production build | Authenticated app/onboarding/preview and widget routes are dynamic. No live API access is required by the build |
| `npm run test:e2e` | PASS: 34 tests, 17 desktop + 17 mobile, 2.5 minutes, no retries | Isolated Chromium fixture flows; all seven dashboard routes have settled-document axe and no-overflow checks; keyboard focus and cross-origin widget behavior verified |
| `node --check public/lattice-widget.js` | PASS | Embed-loader syntax, not installation verification |
| `node --check frontend-infra/fixture-server.mjs` | PASS | Isolated fixture syntax |
| `wc -c public/lattice-widget.js` | 3,131 bytes uncompressed | Loader only; iframe loads the Next/React UI separately |

Final browser run: **34 passed (2.5m)**. Report: `e2e/report/index.html`; synthetic screenshots are attached in that report. Earlier failures were not marked passed: the browser detected incorrect native-fetch invocation, callback origin loss, mobile focus restoration, duplicate complementary landmarks and missing conversation section headings; fixes and regression checks were applied before rerunning. Browser selectors were tightened to ignore Next's route-announcer alert and hidden modal contents. Axe analysis waits for streamed metadata and entry-animation opacity to settle rather than auditing a half-loaded document. Fixture runs exercise actual frontend forms, Supabase SDK/cookie handling and the server relay, but their upstream services are doubles.

## Test specification / RED → GREEN evidence

Journeys derived from the requested frontend/widget workstream and the project's MVP/architecture docs. This directory is not a Git repository; no checkpoint commits were created.

- `tests/frontend/api.test.ts` initially failed for missing typed transport; implementation then passed. Added a native-fetch receiver regression that failed with `NETWORK_ERROR`, then passed after binding browser fetch to `globalThis`.
- `tests/frontend/forward.test.ts` initially failed for missing relay. Multipart/body/bearer preservation, cookie stripping, restricted namespaces, no-store errors and original hosted-widget origin are verified. When the backend added `parentOrigin`, revised origin tests were RED before removing site-header substitution, then GREEN.
- `tests/frontend/resources.test.tsx` caught loss of same-tenant data during invalidation. Keeping scoped data while immediately clearing changed tenant/client data made both tests pass, preventing accepted jobs from unmounting on their own cache invalidation.
- `tests/frontend/components.test.tsx` verifies immutable exact-version passages, unsupported-turn clearing, revoked evidence redaction, text-only untrusted content, errors/receipts/quota, and no dashboard sign-in link for expired public sessions. The visitor-session case was RED before its implementation, then GREEN.
- `tests/frontend/transport-surface.test.ts` verifies every wrapped contract operation and HTTP method, public/dashboard token boundaries, no mutation replay, job state transitions/terminal failures/bounded pending receipts, and revoked assets.
- `tests/frontend/widget-storage.test.ts` verifies agent+site scope, legacy-data preservation, corrupt/blocked storage, and pending job receipts for reload/resumption without another POST. The pending-receipt test failed before implementation and then passed.
- `tests/frontend/modal.test.tsx` reproduces mobile focus loss when a dialog is removed after Escape. It failed before explicit opener-focus restoration and then passed; the desktop and mobile keyboard browser targets were rerun successfully after waiting for streamed metadata to settle before axe analysis.
- A prior read-only Python link check recorded README plus nine docs with zero missing local links; the current delivery and deployment links were reviewed while updating the canonical notes. Desktop/mobile Knowledge screenshots were visually inspected for preserved green/paper styling, visible focus and confined table overflow.
- `e2e/application.spec.ts` exercises authentication/onboarding, every nav route, owner/member workspace selection, import failed/partial states, query-only navigation, archive/restore/delete, archived whitespace correction rejection, draft vs published evidence, conversation → approved correction → saved check → human verdict → publish, rollback/deletion, imports/partial runs, expired/network/conflict/quota behavior, billing unavailability, legacy export, cross-origin widget/citations/continuity/feedback/email handoff, pending-job resumption and mobile/keyboard accessibility.

## Required configuration / staging gates

1. Frontend `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `BACKEND_API_ORIGIN=http://localhost:4000` (origin only). Rebuild after public config changes. No service-role, AI, Stripe or email secret belongs in the frontend/browser.
2. Supabase: site origin + `/auth/callback` redirect allowlist, confirmation/recovery email configuration, real isolated test account. Verify the entire confirmation/recovery flow with delivered staging email; fixture acknowledgement is not delivery.
3. Backend: independently provision database/migrations, run API and worker, set its `APP_ORIGIN` to the frontend origin, provide Supabase JWT validation, AI/parsing/embedding, quota configuration and Stripe/email sandbox providers as documented in `backend/README.md`.
4. Widget: published agent release/config, allowed installing site origin, load script from the frontend origin. Backend `parentOrigin` validates the installation policy; the session's opaque token is the visitor credential. Review third-party-storage restrictions in target browsers; blocked storage is visibly reported and continuity becomes page-session-only. No private per-customer knowledge is exposed.
5. Test billing with Stripe test-mode resources/webhooks only. A return query is never a payment receipt. Backend checkout and portal URLs now include the workspace ID; `/settings` remains a compatibility redirect, not proof of payment.
6. Email: enable sandbox delivery intentionally and independently verify queued → sent/failed results, retry idempotency and one logical escalation. Fixture `sent` proves only frontend state presentation.
7. Backend revision and installation-observation contracts are implemented. Live staging must still verify conflict behavior, session observations and third-party-storage restrictions before declaring a real site rollout verified.

## Live integration / release verdict

**NOT VERIFIED against provisioned live services.** The workstream's frontend checks do not establish real backend tenant isolation, parser quality, source eligibility/revocation enforcement, durable-job reliability, billing correctness, email delivery, backup behavior, answer accuracy or performance targets.

Visual regression comparison is **INCONCLUSIVE**: no committed baselines were supplied. Responsive screenshots and automated keyboard/axe checks are evidence of current layouts, not a full WCAG certification. Core Web Vitals, screen-reader review, Safari/Firefox and real-browser third-party-storage behavior were not measured.

The application must not be declared production-ready before the live staging gates pass; local fixture success is not evidence of provider delivery, backups or production ingress.

## Delivery self-evaluation

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | Actual transport/test/build results are recorded; upstream real-service correctness is still unverified and is not inferred from fixture results |
| Completeness | 4/5 | Source/settings revisions, installation observations and workspace-preserving billing returns are implemented. Live provider and deployment receipts remain outside this fixture scope |
| Clarity | 4/5 | Implemented/blocked/live-unverified behavior is separated in delivery and contract-request docs; the large workflow surface still requires reading those notes |
| Actionability | 3/5 | `.env.example`, backend-start instructions and isolated checks are reproducible, but real service provisioning and deployment receipts are prerequisites for full use |
| Conciseness | 4/5 | Summary points to canonical evidence rather than repeating all test logs; exhaustive operation wrappers/tests are necessarily longer than a small feature |

Overall: **4.0/5 — substantial frontend delivery, locally verified but not live-service verified.** Highest-impact follow-up: provision isolated staging and verify actual auth/ingestion/revocation/billing/email/storage/deployment behavior. Fixture tests are not substituted for those receipts.
