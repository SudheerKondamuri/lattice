# Pricing and unit economics

Status: Proposed launch pricing. Costs are estimates, not observed usage. Prepared 2026-10-05.

Frontend implementation note: Settings reads the backend's usage/subscription receipt and follows backend-issued checkout/portal URLs. It does not set subscription state or invent prices/renewal dates. Isolated tests deliberately disable real payments. The planning figures below are not validated billing configuration or measured production economics.

## Plans

Same core functionality on both plans; allowances differ.

| Allowance | Starter | Growth |
| --- | ---: | ---: |
| Monthly price | $39 | $99 |
| Completed customer AI replies | 1,000 | 4,000 |
| Quality-check cases/month | 200 | 500 |
| Indexed source pages | 250 | 1,000 |
| OCR/visual pages processed/month | 100 | 250 |
| Members | 2 | 5 |
| Agents | 1 | 1 |
| Branding removal | Included | Included |
| Daily website checking | Included | Included |
| Comparison/correction | Included | Included |

A source page means one web URL or PDF page, subject to disclosed size limits. Show estimates and partial-import status before accepting an oversized import. Explicit per-file, extracted-content, storage, and processing bounds must be established from parser benchmarks before paid launch.

Proposed 14-day trial: 100 replies, 50 checks, 50 source pages, 10 OCR pages. Bound trial abuse and total trial spend.

## Metering contract

- One completed customer AI-authored reply uses one reply. Generated clarifications count; system messages, contact forms, and failed generations do not.
- One quality-check case is one question evaluated against a candidate release, optionally compared with a stored baseline. Reruns count again.
- Unchanged source pages do not trigger unnecessary processing/checks.
- Request retries must not double-charge a completed response.
- Extra replies: proposed $15 per 1,000; automatic purchase off by default.
- Extra checks: explicit purchase, with final package price set after measurement.
- When checks run out, auto-publication pauses. Manual review/publish remains available. Never silently bypass the configured checks or incur overages.
- When reply allowance/spend limits are exhausted, explain the limit to the owner and show the visitor an actionable support-contact fallback.

## Published model-price baseline

| Model | Input / million tokens | Output / million tokens |
| --- | ---: | ---: |
| GPT-4.1 mini | $0.40 | $1.60 |
| GPT-4.1 | $2.00 | $8.00 |
| text-embedding-3-small | $0.02 | N/A |

Sources reviewed 2026-10-05:

- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/models/gpt-4.1
- https://developers.openai.com/api/docs/models/text-embedding-3-small

Example reply: 8,000 input tokens and 500 output tokens on GPT-4.1 mini costs $0.0032 + $0.0008 = **$0.004** before auxiliary work.

Planning reserves:

- $0.006 per customer reply, including lightweight auxiliary work and retries.
- $0.025 per quality-check case, including candidate generation and grading.
- $0.02 per bounded OCR/visual page. Replace this assumption with measured parser/model costs.

No cached-input discount is required by this model. Long histories, multiple generation attempts, or larger models can invalidate these estimates.

## Infrastructure

Budget approximately $70–130/month shared infrastructure initially: managed database/auth/storage, app/worker compute, email, monitoring, and incidental egress. This is a budget, not a hosting quote.

- Supabase Pro starts at $25/month: https://supabase.com/pricing
- Railway Pro has a $20 minimum including usage, then usage-based resources: https://docs.railway.com/pricing/plans

Avoid counting Railway's included usage twice. Reassess worker CPU/RAM costs with representative OCR batches.

## Full-allowance illustration

Assume $100 shared monthly infrastructure across 20 paying workspaces and approximate payment fees of 3% + $0.30. Actual processor fees depend on country/provider.

| Monthly expense | Starter | Growth |
| --- | ---: | ---: |
| Replies | $6.00 | $24.00 |
| Checks | $5.00 | $12.50 |
| OCR/visual reserve | $2.00 | $5.00 |
| Shared infrastructure allocation | $5.00 | $5.00 |
| Payment fees, rounded | $1.50 | $3.30 |
| Total | $19.50 | $49.80 |
| Remaining before labor/tax/acquisition/other overhead | $19.50 | $49.20 |

This is approximately a 50% contribution margin under the stated assumptions. It is not an 80–90% margin business by default. Fewer paying customers increase fixed-cost allocation; high-touch onboarding can erase the remaining margin.

Instrument generation, parsing, evaluation, retries, and support time from the first pilot. Reprice or adjust allowances if observed costs exceed the model. Customer affordability should not depend on unlimited loss-making usage.

## Competitive pricing context

Chatbase lists Hobby at $40/month, Standard at $150/month, Pro at $500/month, and branding removal at an additional $99/month. Its credits can differ from completed-reply units, and broader plans include features outside our MVP. Compare the actual website-support workflow rather than claiming feature-for-feature price parity.

Source: https://www.chatbase.co/pricing
