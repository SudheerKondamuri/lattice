# Frontend → backend integration requests

Coordination receipt. Full repository ownership is now authorized; the formerly requested backend contracts are implemented and still require live staging verification.

## Required contracts

1. **Source/settings concurrency — implemented:** `Source` and `Settings` expose revisions; PATCH requires `expectedRevision` and stale writes return a conflict without overwriting newer state. The frontend sends the revision it read.
2. **Iframe origin convention — now provided:** `WidgetSessionRequest.parentOrigin` was added by the backend workstream. The frontend uses the validated parent-postMessage origin in that field; the relay preserves the hosted iframe's `Origin` (or sanitized iframe referrer origin for GET). It no longer substitutes a claimed installation origin header. Session/token binding remains backend-authoritative. Parent origin/allowlists are not visitor authentication; the opaque token is the visitor credential. Live staging validation remains necessary.
3. **Installation verification — implemented as observation:** `installations` records the agent, site, loader version, release and session observation count. Settings labels this as observed activity rather than claiming human installation success.
4. **Billing return routing — implemented:** checkout and portal URLs include `workspace=<id>` so a multi-workspace owner returns to the correct billing context.

## Existing contracts consumed

API prefix `/api/v1`, backend origin `http://localhost:4000`, Supabase bearer auth, opaque public widget bearer tokens, `Idempotency-Key` on documented operations, durable 202 job polling. No frontend retrieval/publish/billing engine. Draft answers use an omitted `releaseId`; published answers explicitly send the current backend release ID.

## Clarifications needed / honest limitations

- Sources GET has no documented server search/filter parameters: frontend search covers loaded pages and labels that scope.
- Releases expose immutable version-ID lists, not a structured diff endpoint: show exact version-list/config differences rather than inventing a semantic diff.
- Usage has a period-end date and subscription status, but no guaranteed renewal/cancellation/payment-price fields: display only returned information.
