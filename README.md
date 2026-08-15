# autoVet

autoVet is a bilingual monthly roster builder for Taiwanese veterinary clinics. It turns staffing levels, requested leave, contracted hours, and coworker preferences into several deterministic, explainable schedule options.

Traditional Chinese (`zh-TW`) is the default. English is available from the header.

## Dev Container

The recommended local environment is the repository Dev Container. It provides Node.js 22, PostgreSQL 17, Terraform 1.13.5, Google Cloud CLI, Cloud SQL Auth Proxy, `psql`, Playwright Chromium, and Docker/Compose tooling without installing them directly on macOS.

Requirements:

- Docker Desktop
- Cursor with the Anysphere Remote Containers extension

Open the repository in Cursor, run **Dev Containers: Reopen in Container**, and wait for setup to finish. The first build installs npm dependencies and Chromium, initializes Terraform providers, starts the isolated development database, and applies committed Prisma migrations.

Start the application inside the Dev Container:

```bash
npm run dev -- --hostname 0.0.0.0
```

Open the forwarded port 3000. Sign up a clinic owner in the UI to start. OpenAI integration is disabled by default; PostgreSQL is available only through the internal `db:5432` Compose hostname.

Useful commands inside the container:

```bash
# Add optional demo records
npm run db:seed

# Create a migration while developing a schema change
npm run db:migrate

# Match CI before pushing
npm run lint
npm run typecheck
npm test
npm run build

# Authenticate the isolated gcloud profile
gcloud auth login --no-launch-browser
gcloud auth application-default login --no-launch-browser

# Work with the Cloud Run infrastructure
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform validate
```

The gcloud profile, PostgreSQL data, npm cache, `node_modules`, Playwright browsers, and Terraform plugin cache persist in named volumes across ordinary container rebuilds. **Dev Containers: Rebuild Container** refreshes the image without deleting those volumes.

To remove the entire development environment, including its database and isolated gcloud credentials:

```bash
docker compose -f .devcontainer/compose.yaml down -v
```

The Dev Container uses Docker Desktop through the host Docker socket. This is effectively administrative access to Docker Desktop, including its containers, images, volumes, and host-shared files. Use it only with trusted repositories and agents. Production secrets and service-account keys must not be stored in the Dev Container.

The development stack in `.devcontainer/compose.yaml` is separate from the production-like root `compose.yaml`; do not use them interchangeably.

## Docker deployment

Requirements: Docker Engine with Docker Compose.

1. Create the runtime environment file:

```bash
cp .env.docker.example .env.docker
openssl rand -base64 48
```

Put the generated value in `AUTH_SECRET` and choose a strong URL-safe `POSTGRES_PASSWORD`. After the stack is up, create the first clinic owner in the sign-up page. `OPENAI_API_KEY` is optional.

The previously exposed OpenAI key must be revoked and replaced; never reuse a key copied from chat, shell history, or repository history.

2. Build and start PostgreSQL, migrations, and autoVet:

```bash
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

Open `http://localhost:3000`. The database is only available on the private Compose network. PostgreSQL data persists in the `autovet_postgres-data` named volume.

Migrations run in a one-shot service before the web container starts. Seed demo records explicitly when needed:

```bash
docker compose --env-file .env.docker run --rm migrate npm run db:seed
```

Routine operations:

```bash
# Stop services while preserving data
docker compose --env-file .env.docker down

# Rebuild after application changes
docker compose --env-file .env.docker up --build -d

# Back up PostgreSQL
docker compose --env-file .env.docker exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > autovet-backup.sql

# Restore a backup
docker compose --env-file .env.docker exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < autovet-backup.sql

# Permanently remove containers and database data
docker compose --env-file .env.docker down -v
```

Changing `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` after the volume is initialized does not change the existing PostgreSQL account. Apply the change inside PostgreSQL or recreate the volume after taking a backup.

## What is included

- Four-step staff → constraints → compare → export workflow
- Fixed clinic sessions: 10:00–12:30, 13:30–17:30, and 18:00–22:00
- Seeded deterministic scheduler with hard coverage/time-off constraints and soft fairness/preference scoring
- Per-shift doctor minimum/maximum limits and backup-only doctors used only when regular coverage is unavailable
- Central Taiwanese labor-rule validation, including standard and explicitly attested four-week flexible modes
- Persistent PostgreSQL records for staff, preferences, leave, input snapshots, candidates, selected schedules, and summaries
- Searchable local/cloud schedule history
- Manual same-role assignment cycling with immediate leave warnings
- PDF, PNG, and JPG exports based on a dedicated print layout
- Optional, server-only OpenAI preference summaries; AI never creates assignments
- Signed, HTTP-only clinic-owner sessions scoped to the clinic created at sign-up
- Optional employee cards with experience, expertise, hobbies, and clearly labeled AI scores

## Local setup

Requirements: Node.js 22+ and PostgreSQL.

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`AUTH_SECRET` must contain at least 32 random bytes. Create the first clinic owner in the sign-up page; do not store a shared administrator password in environment variables. `OPENAI_API_KEY` is optional.

The UI keeps a local browser fallback so the workflow and exports remain usable during local UI development without PostgreSQL. Production persistence requires `DATABASE_URL`.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Scheduler tests cover deterministic output, seed diversity, hard coverage, time off, maximum daily hours, consecutive work days, flexible-hours opt-in, and impossible inputs.

## Google Cloud Run deployment

The production baseline in `infra/terraform` targets Google Cloud project `autovet` (`647145801184`) in `asia-east1`. It provisions Artifact Registry, Cloud Run, a separate migration job, Cloud SQL PostgreSQL, Secret Manager, Cloud Scheduler, and keyless GitHub Workload Identity Federation.

Cloud Run uses zero minimum instances and a maximum of three. Scheduler sends an authenticated health request every five minutes to reduce cold starts. This is best-effort only: Cloud Run can still remove an idle instance, and guaranteed warm capacity requires setting the minimum to one.

### One-time bootstrap

Requirements: Terraform 1.7+, Google Cloud CLI, Cloud SQL Auth Proxy, `psql`, Python 3, and OpenSSL.

1. Create a versioned GCS state bucket with uniform access and public-access prevention, then initialize:

   ```bash
   export TF_STATE_BUCKET=autovet-terraform-state-647145801184
   gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
     --project=autovet \
     --location=asia-east1 \
     --uniform-bucket-level-access \
     --public-access-prevention
   gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning

   cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
   terraform -chdir=infra/terraform init \
     -backend-config="bucket=${TF_STATE_BUCKET}" \
     -backend-config="prefix=autovet/production"
   ```

2. Follow the staged foundation apply and interactive secret setup in `infra/terraform/README.md`. Secret payloads are added directly to Secret Manager and never passed through Terraform.

3. Complete a normal `terraform apply`. Grant `autovet-terraform@autovet.iam.gserviceaccount.com` `roles/storage.objectAdmin` on the state bucket so the protected Terraform workflow can manage later changes.

4. Create a protected GitHub environment named `production`, ideally with required reviewers. Configure these repository variables from Terraform outputs:

   ```text
   GCP_PROJECT_ID=autovet
   GCP_REGION=asia-east1
   ARTIFACT_REGISTRY_REPOSITORY=autovet
   CLOUD_RUN_SERVICE=autovet-app
   CLOUD_RUN_MIGRATION_JOB=autovet-migrate
   WIF_PROVIDER=<github_main_workload_identity_provider>
   ENVIRONMENT_WIF_PROVIDER=<github_environment_workload_identity_provider>
   DEPLOYER_SERVICE_ACCOUNT=autovet-github-deployer@autovet.iam.gserviceaccount.com
   MIGRATION_EXECUTOR_SERVICE_ACCOUNT=autovet-github-migrations@autovet.iam.gserviceaccount.com
   TERRAFORM_SERVICE_ACCOUNT=autovet-terraform@autovet.iam.gserviceaccount.com
   TF_STATE_BUCKET=autovet-terraform-state-647145801184
   TF_STATE_PREFIX=autovet/production
   ```

No Google service-account key or production application secret belongs in GitHub.

### Delivery and operations

- Pull requests and pushes run lint, type-checking, unit tests, a production build, and Terraform validation.
- A successful `main` build creates immutable runner and migration images, runs the migration job with its dedicated identity, and deploys only after migration succeeds.
- Infrastructure applies are manual, use the protected `production` environment, and run as a separate Terraform identity.
- Roll back application code by redeploying a previous Artifact Registry digest. Database migrations must follow backward-compatible expand/migrate/contract changes so an older revision remains safe.
- View runtime logs with `gcloud run services logs read autovet-app --project autovet --region asia-east1`.
- Rotate a secret by adding a Secret Manager version, updating its numeric value in Terraform's `secret_versions`, and applying Terraform.
- Cloud SQL has automated backups, point-in-time recovery, connector-only access, and deletion protection. Test restoration before relying on it operationally.

The local Docker Compose deployment remains the development path. `.env.cloudrun.example` documents the runtime-to-Secret-Manager mapping without containing deployable credentials.

## Alternative deployment

The standalone application image can connect to an external PostgreSQL service by setting `DATABASE_URL` at runtime. Run the `migrate` image target against that database before starting the `runner` target.

Never commit `.env`, `.env.docker`, API keys, database credentials, or password hashes. The repository and Docker build context exclude local environment files.

## Labor-law boundary

autoVet is planning assistance, not legal advice. The validator uses conservative, centralized defaults derived from Taiwan's Labor Standards Act:

- 8 regular hours/day and 40 regular hours/week
- no more than 12 total work hours/day
- monthly overtime limit of 46 hours under standard rules
- required rest days and overtime warnings
- four-week flexible scheduling only after explicit approval attestation and employee opt-in

Before production use, the clinic must confirm its industry classification, labor-management approval, overtime agreements, holidays, individual contracts, break arrangements, and current Ministry of Labor guidance. Legal constants live in `src/lib/scheduler/labor.ts` and should be reviewed when regulations change.
