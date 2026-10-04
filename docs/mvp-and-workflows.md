# MVP and workflows

Status: Approved MVP target below. The application surface and local verification are implemented; live provider, deployment and restore drills remain explicit release gates in [application-delivery.md](application-delivery.md). Original target: one full-time developer, eight weeks, managed infrastructure.

## Must have

- Managed authentication, tenant workspaces, owner/member roles.
- One agent per workspace with draft and published configurations.
- Website/sitemap, PDF, TXT/Markdown, Q&A CSV/XLSX imports.
- Structured text/table extraction and bounded OCR, with visible failures.
- Source preview, snippets, authority labels, archive/delete, versions.
- Hybrid retrieval, source citations, clarification, and handoff.
- Responsive website widget, conversation continuity, feedback, email escalation.
- Searchable conversations and an answer-improvement workflow.
- CSV/JSON evaluation imports, baseline answers, side-by-side review.
- Saved checks with owner-approved expected facts, preliminary model grading, and human verdicts.
- Daily website checking, change detection, staged releases, atomic publish, rollback.
- Batched maintenance notifications and escalation-delivery status.
- Two paid plans, bounded trial, usage ledger, quotas, spending controls.
- Monitoring, backups, tenant isolation, bounded jobs and model calls.

## Nice to have

Read-only Chatbase API importer; Notion; DOCX; Slack notifications; richer JavaScript-page crawling; standalone image import beyond PDF OCR; richer visual interpretation; second answer model; shareable reports; live human takeover.

## Do not build for launch

Voice or social channels; full helpdesk; refunds/account-changing actions; arbitrary API tools; workflow builder; video ingestion; knowledge graphs; whole-corpus automatic contradiction detection; autonomous knowledge rewriting; automatic training on all tickets; multiple agents per workspace; agency portal; fine-tuning; self-hosted language models; enterprise SSO/custom roles; self-hosting; contractual SLAs.

If time slips, reduce optional formats and visual enrichment before cutting comparison, correction, or dependable deployment.

## Killer workflow: fix the cause, check the effect

Example: the agent answers a plan-availability question from an outdated FAQ rather than current documentation.

1. **Inspect:** owner opens Improve this answer. Show question, context, answer, actual retrieved passages, source versions/authority, and related conversations. Diagnostic hints are hypotheses, not claims about hidden model reasoning.
2. **Repair:** owner edits/adds an approved snippet, archives or reprioritizes a source, or changes clarification/handoff behavior. Keep a source dependency for approved answers where possible.
3. **Check:** save the original question; run owner-approved related cases and important controls. Show before/after evidence. Never silently alter expected facts to make a candidate pass.
4. **Publish:** show improvements, regressions, and unreviewed cases. Publish a versioned release; retain rollback.
5. **Maintain:** detect changed website content daily, reprocess only changed content, batch updates, rerun affected checks and controls, and notify on actionable exceptions.

Initial publication and updates default to owner review. Owners can opt into automatic publication of ordinary sources after checks pass. Sources explicitly marked approval-required always require review. A detected change to such a source withholds affected source-backed answers until review, rather than presenting suspect knowledge as current.

Check quotas are explicit. Exhaustion pauses automatic publication; owners may review manually or purchase allowance. A source-to-question dependency map is a useful heuristic, not proof that every affected answer was tested.

## Migration

Offer a Move from Chatbase path:

| Material | Migration method |
| --- | --- |
| Q&A | Chatbase-compatible XLSX |
| Text snippets | Markdown/text exports |
| Website | Re-crawl original URLs |
| Documents | Upload originals; extracted-text exports cannot recover layout/images |
| Instructions | Paste into a simplified behavior editor |
| Conversations | Supported export JSON or normalized CSV |

Chatbase's documented source export supports extracted file text, snippets, and Q&A; it does not export website, Notion, or ticket sources through that workflow. Its conversation-export API requires Standard or higher. API import is optional for launch; customers can upload prepared data or paste questions without giving us credentials.

## Comparison case schema

```text
case_id
question
conversation_context   optional
previous_answer        optional
expected_facts         optional
source_reference       optional
category               optional
importance             normal | critical
baseline_timestamp     optional
```

### Procedure

1. Import representative routine questions, known failures, and appropriate-clarification/handoff cases; retain category labels.
2. Split development and holdout sets before tuning. Keep near-duplicate questions in the same split. Imported evaluation data is not added to retrieval knowledge automatically.
3. Generate candidate answers with the supplied context and published/draft release recorded.
4. Show both answers, evidence, preliminary grading, and human verdict: candidate better, baseline better, tie, or ungradable. Optional blinded labels reduce preference bias.
5. Report correctness, completeness, unsupported claims, and appropriate handoff. Compare latency/cost only where measured.

**Historical comparison:** clearly label old baseline answers against current candidate answers, source-date differences, and possible hindsight advantage.

**Current matched comparison:** customer supplies fresh baseline answers using equivalent knowledge and context. The MVP does not automatically invoke a production bot that might perform external actions.

Never present an LLM judge's preference as definitive accuracy. Reveal losses and ungraded cases. Review critical cases manually.

### Deployment switch

Test on staging, install on a selected website section, review live conversations, then replace the previous widget. Keep the customer's old bot/account intact so switching back is straightforward.

## Sources reviewed during planning

- https://chatbase.co/docs/user-guides/chatbot/data-sources.md
- https://chatbase.co/docs/api-v2/conversations/export-conversations.md
- https://chatbase.co/docs/user-guides/chatbot/tests.md
- https://chatbase.co/docs/user-guides/chatbot/backstage.md

Reviewed 2026-10-05; vendor capabilities can change.
