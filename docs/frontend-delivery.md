# Frontend / widget delivery

Status: Frontend service wiring and backend contracts are implemented. Local browser verification passes; live-provider readiness is tracked separately in [application delivery](application-delivery.md).

## Ownership

Full repository ownership was later authorized. Root frontend dependencies remain separate from backend packaging, while the frontend continues to delegate database, retrieval, job-processing, publishing, metering and billing behavior to the backend.

## Implemented

- Central contract-importing API client with Supabase/public bearer-token separation, cancellation, error envelopes/receipts, per-operation idempotency keys where documented, bounded GET job polling, and no automatic mutation retry.
- Restricted same-origin server relay using `BACKEND_API_ORIGIN`; no service credentials, forwarded cookies, upstream redirects, or authenticated-response caching.
- Supabase sign-up, password sign-in, verification/PKCE callback, password recovery/update, sign-out; server-verified protected dashboard/onboarding/preview routes. Relative callbacks preserve the real browser origin behind a reverse proxy.
- Workspace bootstrap/selection, owner/member controls, actual workspace/agent creation, no implicit seeded business state. Resource keys/auth-client identity prevent old-tenant rendering; same-tenant invalidation keeps in-flight workflows mounted.
- Overview uses returned usage, release IDs, conversations, source status and maintenance notifications. Loaded-page counts are labeled; there are no fabricated growth charts or quality scores.
- Website/sitemap and multipart PDF/TXT/Markdown/Q&A CSV/XLSX ingestion, durable job state, failed/partial extraction disclosure, source warnings/history, exact-version inspection, archive/restore, reprocess, original download and permanent-delete confirmation. Query-only navigation controls source/import dialogs.
- Real draft and explicit published-release previews, historical evidence, unsupported-turn evidence clearing, feedback, transcripts/export, dependent approved-answer corrections, explicit owner-approved regression checks. Historical evidence is never looked up from current draft text.
- CSV/JSON case imports, baseline/context/timestamp capture, explicit expected-fact revisions and frozen-holdout enforcement via backend, immutable evaluation snapshots, run history/partial failures, wins/losses/ties/failures/ungraded counts, preliminary-grade disclosure and human verdicts.
- Backend-issued release snapshots, source-version-list/config differences, failing/unreviewed checks, explicit publication confirmation/override acknowledgement, compare-and-swap expected published pointer, rollback with deletion warnings.
- Persisted settings/usage/member reads, membership invitations/removal, genuine backend-issued checkout/portal redirects. No client-side subscription changes or payment simulations.
- Lightweight loader, iframe-isolated responsive widget, public-session continuity scoped by agent/site, published-only questions, returned citation excerpts/version IDs, feedback, queued/sent/failed email handoff, support-contact fallback and genuine public preview. Downloaded originals are labeled as potentially newer than the historical cited passage.
- Native modal focus behavior, hidden desktop navigation on mobile (not focusable off-canvas links), visible focus, adequate text contrast, labelled-action sizing, real input CSS, UTC date formatting and reduced motion. React renders model/source strings as text; URL links reject non-HTTP(S) schemes.
- Legacy browser-preview export without deletion, silent migration or automatic upload.

## Remaining boundaries

1. Source/settings edits now require backend revisions and atomically reject stale writes. Source search covers a paginated loaded page; the contract has no global source search/filter endpoint. Release differences are exact version-ID/config differences, not fabricated semantic diffs.
2. Installation observations are durable and visible in Settings, but an observation is not proof that a human installed the widget or that the browser can retain third-party storage.
3. Source-version history is bounded by what the backend returns; unavailable historical versions are labeled, not replaced.
4. Usage does not supply indexed-page totals, payment prices, guaranteed renewal date or cancellation details. Only returned period/plan/status/limits/spend information is displayed.
5. Real Supabase delivery, backend authorization/ingestion/retrieval, AI quality, Stripe events, email sandbox delivery and production installations still require provisioned staging verification. Test doubles are not that evidence.

Exact backend requests: [frontend-contract-requests.md](frontend-contract-requests.md).

## Main changed file groups

- `src/lib/api.ts`, `resources.ts`, `store.tsx`, `forward.ts`, `presentation.ts`, `supabase-browser.ts`, `supabase-server.ts`; obsolete `seed.ts`, `operations.ts`, `types.ts` and demo tests removed.
- `src/app/api/v1/[...path]/route.ts`, `src/proxy.ts`, auth/onboarding/widget routes; Conversations, Compare, Releases and Settings dashboard routes; protected layouts.
- `src/components/pages/**`, `workspace-shell.tsx`, `knowledge-tools.tsx`, `async-state.tsx`, `evidence.tsx`, `transcript.tsx`, `correction-dialog.tsx`, `evaluation-editor.tsx`, `auth-form.tsx`, `legacy-export.tsx`, `ui.tsx`, marketing labels.
- `src/widget/**`, `public/lattice-widget.js`, `src/app/application.css` and root stylesheet import.
- `tests/frontend/**`, `e2e/application.spec.ts`, `frontend-infra/fixture-server.mjs`, frontend test/config/manifests, `.env.example`, `.gitignore`, README and canonical documentation status notes.

## Verified frontend evidence

Strict typecheck and production build pass; 95 unit/component tests pass; 34 isolated Playwright checks pass across desktop/mobile Chromium with no retries. All seven navigation routes pass settled-document axe/no-overflow checks. The transport/formatting/widget-storage coverage scope is 94.03% lines/statements, 87.90% branches, 97.18% functions — not whole-application coverage. Real backend/provider integration remains unverified.

Verification receipts: [frontend-verification.md](frontend-verification.md).
