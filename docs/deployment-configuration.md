# Deployment configuration guide

This guide configures the current application for an isolated production-like staging environment and then production. It uses the repository's target stack: Supabase Auth/Postgres/private Storage, Azure OpenAI, Azure Container Apps and Resend. Stripe remains disabled until its test-mode flow has been verified.

Do not send any secret value in chat, commit it, put it in a `NEXT_PUBLIC_*` variable, or place it in a frontend image. Use Azure Container Apps secrets, Azure Key Vault, or another protected secret store. The examples below use placeholders only.

## 1. Decide the public origins

Choose these before configuring Auth or deploying:

```text
Frontend: https://app.example.com
Backend:  https://api.example.com
Widget host: the frontend origin above
```

Use the exact frontend origin as backend `APP_ORIGIN`. Do not add a path, credentials, query string or hash. The frontend uses the backend origin through the server-only `BACKEND_API_ORIGIN` variable.

For a first deployment using Azure-generated hostnames, use the final HTTPS frontend hostname as `frontendOrigin` in the Bicep deployment. If you later move to a custom domain, update `APP_ORIGIN`, `BACKEND_API_ORIGIN`, Supabase redirects and the widget allowlist together.

## 2. Create the Supabase project

1. Create a production Supabase project and record its project URL from **Connect**. This becomes `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`.
2. From **Settings → API Keys** or the project **Connect** dialog, copy the public publishable/legacy anon key. The current code variable is named `SUPABASE_ANON_KEY` on the backend and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on the frontend.
3. Copy the server-only secret/legacy service-role key into backend `SUPABASE_SERVICE_ROLE_KEY`. Keep it only in the API/worker secret store. It bypasses Supabase RLS and is used for private Storage operations.
4. Create a private Storage bucket named `lattice-originals`, or choose another name and use that exact value for `SUPABASE_STORAGE_BUCKET`. Public access must be disabled.
5. In **Authentication → URL Configuration**:
   - Set **Site URL** to the frontend origin.
   - Add `https://app.example.com/auth/callback` to the redirect allowlist.
   - Add the recovery callback used by the app, for example `https://app.example.com/auth/callback?next=/auth/update-password`.
   - Add the equivalent localhost callback only for local development.
6. Enable email confirmation. For production Auth email, configure custom SMTP under **Authentication → SMTP Settings**. The Supabase default mailer is for limited development/testing and is not the Lattice escalation sender.

### Database URLs and roles

The API must not use the Supabase `postgres` owner or a `BYPASSRLS` role at runtime.

1. Create a dedicated non-superuser runtime role using a strong generated password. Run the following as the database owner in the Supabase SQL Editor, replacing the password and role name if needed:

   ```sql
   create role lattice_runtime login password 'GENERATE_AND_PASTE_A_LONG_RANDOM_PASSWORD'
     nosuperuser nobypassrls;
   grant usage on schema public to lattice_runtime;
   ```

2. Configure the migration owner connection from the Supabase **Connect** dialog. Use a direct connection where available; migrations need schema privileges. This becomes `MIGRATION_DATABASE_URL`.
3. Configure the runtime connection with the session pooler connection from **Connect** when the Container App is IPv4-only. Use the runtime role credentials and append `?sslmode=require`. This becomes `DATABASE_URL`.
4. Run the migrations once with the migration connection:

   ```sh
   cd backend
   npm run migrate
   ```

5. After migrations, grant the runtime role access to the created objects. Run as the migration owner:

   ```sql
   grant select, insert, update, delete on all tables in schema public to lattice_runtime;
   grant usage, select on all sequences in schema public to lattice_runtime;
   grant execute on all functions in schema public to lattice_runtime;
   alter default privileges for role postgres in schema public
     grant select, insert, update, delete on tables to lattice_runtime;
   alter default privileges for role postgres in schema public
     grant usage, select on sequences to lattice_runtime;
   alter default privileges for role postgres in schema public
     grant execute on functions to lattice_runtime;
   ```

   If your migration connection uses a role other than `postgres`, replace `postgres` in the `alter default privileges` statements with that migration role.

6. Confirm the runtime role is not privileged:

   ```sql
   select rolname, rolsuper, rolbypassrls
   from pg_roles
   where rolname = 'lattice_runtime';
   ```

Both flags must be `false`.

The Supabase database connection string contains a password. Store it only in the backend secret store. Percent-encode reserved characters in the password if they are placed in the URL.

## 3. Configure Azure OpenAI

1. Create an Azure OpenAI resource in the same broad region as the backend where possible.
2. From the resource's **Keys and Endpoint**, copy the endpoint and one API key:
   - `AZURE_OPENAI_ENDPOINT=https://RESOURCE.openai.azure.com`
   - `AZURE_OPENAI_API_KEY=...`
3. Create three model deployments. Deployment names are your chosen names, not necessarily the underlying model names:
   - Answer chat deployment: `gpt-4.1-mini` or the approved compatible chat model → `AZURE_OPENAI_ANSWER_DEPLOYMENT`
   - Grading chat deployment: `gpt-4.1` or the approved compatible chat model → `AZURE_OPENAI_GRADING_DEPLOYMENT`
   - Embedding deployment: `text-embedding-3-small` → `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`
4. Confirm the embedding deployment supports 1536 dimensions. The code sends `dimensions: 1536`.
5. Use the API version supported by your resource, initially `2024-10-21` unless Azure requires another supported version:

   ```text
   AI_PROVIDER=azure
   AZURE_OPENAI_API_VERSION=2024-10-21
   ```

The `ANSWER_MODEL`, `GRADING_MODEL` and `EMBEDDING_MODEL` values are retained as pricing/model labels. Azure requests use the three deployment variables. Never put the Azure key in the frontend.

## 4. Configure Resend and email

There are two separate email paths:

- **Supabase Auth email:** confirmation and password recovery. Configure this through Supabase custom SMTP.
- **Lattice email handoff:** visitor escalations. Configure these backend variables.

1. Create a Resend account.
2. Add and verify the sending domain under **Domains**. Complete the requested DNS records, normally SPF/DKIM and any recommended DMARC policy.
3. Create a Resend API key scoped to the production project/domain if available.
4. Set `EMAIL_FROM` to a verified sender, for example `Lattice Support <support@example.com>`.
5. Keep delivery disabled while configuring:

   ```text
   EMAIL_DELIVERY_ENABLED=false
   ```

6. After staging delivery and retry behavior are verified, change it to `true` and set `RESEND_API_KEY`.

The application records queued, sent and failed handoffs. Provider acceptance is not proof that a message reached a human inbox.

## 5. Configure Stripe only when ready

Leave billing disabled initially:

```text
BILLING_ENABLED=false
```

When enabling billing:

1. Use a Stripe test-mode sandbox first.
2. Create two recurring prices: one for the Starter plan and one for Growth.
3. Copy their `price_...` IDs into `STRIPE_STARTER_PRICE_ID` and `STRIPE_GROWTH_PRICE_ID`.
4. Copy the server secret key into `STRIPE_SECRET_KEY`.
5. Create a webhook endpoint directly to the backend, not the frontend relay:

   ```text
   https://api.example.com/api/v1/webhooks/stripe
   ```

6. Enable these events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. Copy the endpoint signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
8. Configure the Stripe Customer Portal and verify checkout, cancellation, webhook replay and multi-workspace return routing.
9. Only then set `BILLING_ENABLED=true`.

Use separate Stripe test and live keys, prices and webhook secrets. A return URL containing `billing=success` is not a payment receipt; the subscription webhook is authoritative.

## 6. Frontend environment files

### Local frontend: `.env.local`

Create it from the committed template:

```sh
cp .env.example .env.local
```

Set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_LEGACY_ANON_KEY
BACKEND_API_ORIGIN=http://localhost:4000
```

`NEXT_PUBLIC_*` values are public. `BACKEND_API_ORIGIN` is read by the Next server relay and should contain only the backend origin.

### Production frontend container

Public Supabase values are build arguments:

```sh
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_LEGACY_ANON_KEY \
  -t REGISTRY/lattice-web:VERSION .
```

Set `BACKEND_API_ORIGIN=https://api.example.com` as a runtime Container App environment value. Do not put backend secrets in the frontend image.

## 7. Backend environment file

For local development, copy `backend/.env.example` to `backend/.env`. For production, put the same names in the API and worker secret/environment configuration. The API and worker need the same database, Supabase, AI, limits and provider settings.

### Required operational values for the Azure target

```dotenv
DATABASE_URL=postgresql://lattice_runtime.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
MIGRATION_DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require
APP_ORIGIN=https://app.example.com
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_LEGACY_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SECRET_OR_LEGACY_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=lattice-originals

AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://RESOURCE.openai.azure.com
AZURE_OPENAI_API_KEY=YOUR_SERVER_ONLY_AZURE_KEY
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_ANSWER_DEPLOYMENT=lattice-answer
AZURE_OPENAI_GRADING_DEPLOYMENT=lattice-grading
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=lattice-embedding

EMAIL_DELIVERY_ENABLED=false
RESEND_API_KEY=
EMAIL_FROM=Lattice Support <support@example.com>

BILLING_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_GROWTH_PRICE_ID=
```

`HOST=0.0.0.0`, `PORT=4000`, `PARSER_PYTHON=/opt/parser/bin/python`, `PARSER_ARTIFACTS_PATH=/opt/docling-models`, `WORKER_CONCURRENCY=2`, the spend reserves and ingestion limits can initially remain at the values in `backend/.env.example`. Review them against measured traffic and provider costs before increasing limits. `TRUST_PROXY` should remain `false` unless a trusted proxy with known IP/CIDR ranges is placed in front of the API.

## 8. Deploy in order

1. Provision Supabase, create the private bucket and database runtime role.
2. Configure Auth URLs/SMTP and Azure OpenAI deployments.
3. Build and push the backend image from `backend/` and the frontend image from the repository root.
4. Run `node dist/backend/src/migrate.js` once with `MIGRATION_DATABASE_URL`.
5. Deploy the API, worker and frontend Container Apps from `backend/deploy/azure-container-apps.bicep`. Supply secret parameters through a protected deployment mechanism; do not put them in Git or shell history.
6. Set the frontend runtime `BACKEND_API_ORIGIN` to the API FQDN and verify the final frontend origin matches backend `APP_ORIGIN`.
7. Start with `EMAIL_DELIVERY_ENABLED=false` and `BILLING_ENABLED=false`.
8. Check:

   ```sh
   curl -fsS https://api.example.com/healthz
   curl -fsS https://api.example.com/readyz
   ```

   `/readyz` requires a migrated database and a recent worker heartbeat.
9. Test signup/confirmation, workspace creation, source import, worker completion, draft answer, publish, widget session, deletion and restart recovery in isolated staging.
10. Enable Resend sandbox delivery, verify one handoff and its retry behavior, then enable Stripe test mode and verify webhook receipts.
11. Configure encrypted backups and perform a restore/deletion replay drill before production traffic.

## Variable placement summary

| Variable | Frontend/browser | API | Worker | Secret? |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Build/public | — | — | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build/public | — | — | No |
| `BACKEND_API_ORIGIN` | Next server runtime | — | — | No, but server-only |
| `DATABASE_URL` | — | Yes | Yes | Yes |
| `MIGRATION_DATABASE_URL` | — | Migration only | — | Yes |
| `SUPABASE_URL` | — | Yes | Yes | No |
| `SUPABASE_ANON_KEY` | — | Yes | Yes | Public key value |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Yes | Yes | **Yes** |
| Azure/OpenAI variables | — | Yes | Yes | API keys **yes** |
| Resend variables | — | Yes | Yes | API key **yes** |
| Stripe variables | — | Yes | — | Secret/signing secret **yes** |

## Official provider pages

- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Azure OpenAI resource and model deployment](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/create-resource)
- [Stripe API keys](https://docs.stripe.com/keys)
- [Stripe webhook endpoints](https://docs.stripe.com/api/webhook_endpoints/create)
