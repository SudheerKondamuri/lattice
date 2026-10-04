# Risks and thesis corrections

Status: Planning risks, not observed production incidents.

Current frontend delivery risks: existing source/settings writes are blocked until atomic revision validation is documented; there is no automatic installation receipt. The frontend has removed seeded business state and simulated replies/successes. Isolated tests cannot establish live tenant authorization, answer correctness, email delivery, payment processing or production performance. See [frontend-delivery.md](frontend-delivery.md) and [frontend-verification.md](frontend-verification.md).

| Risk | Failure consequence | Response |
| --- | --- | --- |
| Answers are not materially better | Customers see no quality reason to switch | Use real held-out questions, inspect losses, improve recurrent failure types. If quality is equivalent, sell demonstrated operational/value advantages rather than claiming superiority. |
| Knowledge is wrong or absent | Retrieval repeats errors or invents unsupported facts | Surface missing/contradictory evidence and let owners supply approved facts. Promise less maintenance, not none. |
| Buyers need account actions | Product is insufficient for their actual support workload | Qualify by question mix; start with documentation-answerable support. |
| Evaluation flatters our model | Comparison becomes misleading marketing | Blind labels, owner-approved facts, frozen holdouts, manual critical-case review, and visible ungraded results. |
| Maintenance creates more work | Alerts, checks, and approvals overwhelm owners | Batch changes and prioritize actionable exceptions. Measure owner time. |
| Costs exceed allowances | Affordable plans lose money | Meter every pipeline stage, bound context/retries/OCR/trials, and reprice when necessary. |
| Scope expands | Eight weeks becomes six months | Preserve website chat, email handoff, knowledge repair, and comparison. Keep excluded features excluded. |
| Unknown provider is not trusted | Customers avoid switching despite modest gains | Show comparisons, support limited deployment and rollback, provide exports and dependable handoff. |
| No acquisition channel | Good software has no customers | Recruit pilots during development; use comparison as the sales entry point. |
| Cross-tenant data leak | Trust collapses | Tenant isolation, scoped storage, deletion/revocation, and authorization verification are release requirements. |

## Explicit corrections

- “Understands your business” means using approved customer-facing knowledge; it does not imply access to undocumented facts or private account state.
- OCR/layout extraction is feasible early. Arbitrary diagram, screenshot, and video comprehension is not a launch guarantee.
- Chatbase already offers actions, correction, tests, and management workflows. We compete on measured overall experience rather than claiming those categories are novel.
- Low price alone is fragile. Full-allowance margins in the initial model are around 50% before labor and acquisition, not 80–90%.
- Historical comparisons can be biased by newer knowledge. Label them and use matched comparisons before stronger claims.
- Source-linked regression checks reduce risk; they cannot prove that every affected question was checked.
- Lattice is a working label, not a cleared public brand. Replylane was rejected because replylane.ai already hosts an AI messaging product.
