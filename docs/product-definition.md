# Product definition

Status: Draft v1. Prepared 2026-10-05. The product thesis is approved; details below are recommended launch decisions.

Implementation status: The service-backed frontend/widget workstream follows this journey, but safe existing-source/settings persistence and automatic installation receipts remain contract-blocked. [Frontend delivery](frontend-delivery.md) distinguishes implemented, blocked and live-unverified behavior. [Frontend verification](frontend-verification.md) records actual checks; illustrative marketing diagrams are not measured customer results.

## Goal

Build a hosted, website-first AI customer-support platform. Businesses import their knowledge, inspect what was understood, compare answers against an existing bot, deploy a widget, and improve the agent through a connected correction workflow.

Core loop: **Import → inspect → answer → identify a problem → fix knowledge → check effects → publish.**

## First customer

A small B2B software company with a public help center and repeated product-usage questions, currently using Chatbase or another website bot alongside a support inbox.

Recommended profile:

- Approximately 5–50 employees; founder-led support or 1–5 support staff.
- Roughly 30–300 help articles, FAQs, guides, and some PDFs.
- Hundreds to a few thousand monthly conversations.
- Buyer: founder, support lead, or customer-success lead.
- Common requests: setup, configuration, feature availability, troubleshooting, documented policies.
- Friction: repeated corrections, outdated answers, manual knowledge preparation, or an expensive plan for a limited website-support use case.

The essential qualification is that a substantial share of questions can be answered from knowledge approved for disclosure to website visitors. This matters more than company size.

Start here because installation is simple, real conversations supply evaluation material, product changes create recurring maintenance work, and documentation-based support can deliver value before account integrations exist. This is an initial segment, not a permanent industry restriction.

Businesses primarily requiring refunds, order changes, private account lookups, or phone support are poor first customers for this MVP.

## Operational promise

“Answers documented product and support questions accurately, stays current with approved knowledge, and hands off requests it cannot answer.”

“Understands your business” is a positioning ambition, not a promise to infer undocumented facts or access private customer state.

## Complete customer journey

1. **Sign up:** enter business name, website/help-center URL, support email, agent name, and accent color. Create one workspace and one draft agent automatically.
2. **Import:** discover website/sitemap URLs, exclude irrelevant paths, upload supported documents, and import Q&A. Show discovered, processing, ready, needs-review, and failed states. Disclose partial extraction.
3. **Inspect:** show original source, extracted content, freshness, active/archived status, authority, warnings, and published version. Focus attention on exceptions.
4. **Configure:** business description, tone, supported topics, handoff wording, source authority, and approved answers. Advanced instructions are optional; model selection is not an onboarding requirement.
5. **Preview:** ask questions, inspect supporting evidence, import real questions, save important checks, and compare baseline answers. Distinguish draft from published behavior.
6. **Deploy:** install one embed script and verify installation. Provide conversation continuity, citations, starter questions, feedback, and explicit support contact.
7. **Improve:** act on unanswered questions, negative feedback, failed imports, changed sources, and failing checks. Repair knowledge, test effects, and publish a release.
8. **Manage:** review usage, allowances, renewal date, and spending cap.

MVP handoff is an email escalation with customer contact details, transcript, and context. The business replies from its existing inbox. The widget explicitly says the team will reply by email.

All agent knowledge is customer-facing. Conversation imports are evaluation-only until an owner deliberately promotes a cleaned, reusable answer into knowledge.

## Main dashboard

| Section | Contents |
| --- | --- |
| Overview | Agent status, actionable issues, activity, source freshness, usage, recent conversations |
| Knowledge | Sources, extracted content, authority, versions, changes, publishing |
| Conversations | Transcripts, feedback, escalations, Improve this answer |
| Compare & Check | Question imports, side-by-side results, recurring checks |
| Settings | Behavior, widget, deployment, members, billing |

Keep Preview agent available as a persistent action. Overview prioritizes issues needing attention over vanity charts.

Keep helpful feedback, handoff rate, and confirmed resolution separate. Silence is not resolution. Do not invent an aggregate “AI quality score.”

## Three product-level advantages

### 1. Dependable use of existing knowledge

Preserve document structure, tables, page references, and OCR-accessible content; expose extraction problems; distinguish authoritative, reference, and archived sources. Answer with inspectable evidence.

Measure owner preparation time and human-reviewed correctness on held-out questions. Arbitrary diagram and video understanding is outside the initial promise.

### 2. Shorter maintenance loop

Connect conversations, supporting sources, corrections, checks, and publishing. Link approved answers to their supporting sources so future source changes can trigger review.

Measure repair time, repeated failures, and weekly owner maintenance time. Existing correction/testing features in competitors are a baseline to execute against, not grounds for rejecting the product.

### 3. Demonstrable value before migration

Import real questions and prior answers; expose wins, losses, ties, and ungraded cases; support reversible installation and transparent pricing.

Measure time to useful comparison, trial-to-deployment conversion, and the customer's total operating cost.

## Definition

Lattice is a hosted AI website-support platform for small software businesses. It turns existing customer-facing knowledge into cited answers, routes unresolved requests to the existing support inbox, and makes knowledge correction, regression checking, and publishing one workflow. Customers can compare it with their current bot before switching.
