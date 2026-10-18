# Lattice

Website support grounded in customer-facing knowledge: import → inspect → answer → correct → check → publish. Lattice remains a working label, not a cleared public brand.

**Status:** The full application now uses the API v1 contract and durable backend factory. Authentication, workspaces, source ingestion/inspection/lifecycle actions, revision-protected source/settings edits, preview, conversations/corrections, checks, releases, installation observations, billing links, and the public widget are wired to real service calls. Local backend/frontend verification is complete; live Supabase, Azure OpenAI, Resend and hosting verification remains a deployment gate. See [application delivery](docs/application-delivery.md) and [frontend verification](docs/frontend-verification.md).

## Frontend development

Node 22+ and npm. Dependencies and packaging are separate from `backend/`; this is not an npm workspace.

```sh
npm ci
cp .env.example .env.local
# Fill public Supabase URL/anon key and server-only BACKEND_API_ORIGIN.
npm run dev
```

Dashboard: `http://localhost:3000`. Configure Supabase's allowed redirect URLs for `/auth/callback` on your local and deployed frontend origins. Use PKCE confirmation/recovery links or Supabase token-hash verification links. Never put a Supabase service-role key, AI key, email key or Stripe secret in a `NEXT_PUBLIC_*` setting. Public settings must be configured before building.

Start the API **and worker** separately using [backend setup](backend/README.md). Default API origin: `http://localhost:4000`; the Next server relays `/api/v1/bootstrap`, `/api/v1/workspaces/**` and `/api/v1/public/**`. It forwards explicit bearer tokens and multipart bodies, strips cookies, does not follow upstream redirects, and never caches responses. Stripe webhooks must reach the backend directly, not this restricted frontend relay.

Missing services produce unavailable/error states, not seeded workspaces, simulated answers, payments or sent-email notifications. Queue acceptance is not completion. Stopping status observation does not cancel a durable backend job.

## Website widget

Publish approved knowledge/configuration, allow the staging site's origin, then copy the script from Settings:

```html
<script src="https://YOUR_FRONTEND/lattice-widget.js" data-agent="BACKEND_AGENT_UUID" defer></script>
```

The small loader creates an iframe on the frontend origin. The widget uses only public session APIs and an opaque visitor token, scoped in widget-owned storage by agent + installing site. It does not read dashboard auth. Origin allowlists/parent-origin checks are deployment policy, **not visitor authentication**. The installation preview uses real public endpoints and real reply allowance; it requires an allowed origin and a published release. A preview is not an installation receipt.

## Verification

```sh
npm run typecheck
npm test
npm test -- --coverage
npm run build
npm run test:e2e
```

Playwright starts an isolated, explicitly test-only GoTrue/API fixture on port 4410 and a Next instance on 3050 with `.next-e2e` output. It does not use real customer accounts, send email, call AI, or trigger payments. Fixture tests verify frontend behavior and transport boundaries, not live backend/Supabase/Stripe/email correctness. For live staging, provision isolated accounts and follow [verification notes](docs/frontend-verification.md); do not point the fixture suite at production.

Previous `lattice-workspace-v1` browser preview data is preserved untouched. Sign-in and Settings offer an explicit export. Nothing is silently deleted or uploaded; reviewed knowledge can subsequently be imported through the normal ingestion flow.

## Product documentation

- [Product definition](docs/product-definition.md)
- [MVP and workflows](docs/mvp-and-workflows.md)
- [Architecture](docs/architecture.md)
- [Pricing assumptions](docs/pricing-and-unit-economics.md)
- [Delivery criteria](docs/delivery-plan.md)
- [Application delivery](docs/application-delivery.md)
- [Deployment configuration](docs/deployment-configuration.md)
- [Risks](docs/risks.md)
