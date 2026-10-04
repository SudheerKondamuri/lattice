# Azure Container Apps deployment

This template deploys separate API and worker Container Apps and a Log Analytics workspace. It does not create Supabase, Azure OpenAI, Resend, a registry, DNS, a database, or a public Storage bucket. Those resources remain explicitly provisioned by the operator.

## Safe order

1. Create a dedicated Azure resource group and an Azure Container Registry.
2. Create Supabase production Auth/Postgres/pgvector/Storage. Create the private bucket named `lattice-originals`; disable public access. Create a pooled runtime database URL and a separate migration URL. Do not use a Supabase service-role key as the database password.
3. Create Azure OpenAI deployments for answer, grading, and 1536-dimensional embeddings. Confirm their deployment names and API version.
4. Build and push the backend image from `backend/`, and build the frontend image from the repository root with the public Supabase values as build arguments:

   ```sh
   docker build -t REGISTRY/lattice-backend:VERSION ./backend
   docker push REGISTRY/lattice-backend:VERSION
   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=PUBLIC_ANON_KEY -t REGISTRY/lattice-web:VERSION .
   docker push REGISTRY/lattice-web:VERSION
   ```

5. Run the migration image once using `node dist/backend/src/migrate.js` with the migration URL. Inspect migration output before enabling traffic. This is a one-off operator action; the API and worker do not run migrations on startup.
6. Deploy the template with secret parameters supplied through a protected deployment mechanism. Never put secret values in a committed parameter file, shell history, or frontend environment.
7. Configure the frontend `BACKEND_API_ORIGIN` to the API FQDN, set `APP_ORIGIN` to the frontend origin, and configure Supabase redirect URLs.
8. Verify `/healthz`, `/readyz`, signup, import, answer, publish, widget session, installation observation, deletion, and worker restart in an isolated staging workspace before production traffic.

The template uses `activeRevisionsMode: Single`; use a separate resource group/environment for staging. For rollback, deploy the previous immutable image tag and preserve the database migration compatibility. Do not roll back the database independently without checking the migration receipt.

The template defaults Resend delivery off and does not configure Stripe. Enable those only after test-mode receipts, sender verification, webhook signature routing and workspace-return URLs have been checked.
