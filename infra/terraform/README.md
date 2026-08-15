# autoVet Google Cloud infrastructure

This directory provisions the Google Cloud baseline for `DiegoWu/autoVet`:

- required Google APIs and a Docker Artifact Registry repository with cleanup policies;
- Cloud SQL for PostgreSQL 16 with public IP, no authorized networks, connector-only access, automated backups, point-in-time recovery, and deletion protection;
- Secret Manager containers only—Terraform never creates secret versions;
- dedicated service accounts and scoped IAM for the application, migrations, Scheduler, GitHub Actions, and Terraform;
- GitHub Workload Identity Federation for the exact repository, with separate main-branch deployment and protected-environment migration identities;
- a public Cloud Run v2 service, a separately invokable migration job, and an authenticated five-minute Scheduler ping.

## Prerequisites

- Terraform 1.11 or newer
- a Google Cloud identity allowed to enable APIs and create the resources in this module
- `gcloud` authenticated to project `autovet`
- for secret bootstrap: `cloud-sql-proxy`, `psql`, `pg_isready`, Python 3, and OpenSSL

Copy `terraform.tfvars.example` to `terraform.tfvars` and adjust only non-secret settings. No variable accepts a password, API key, database URL, or application secret.

Create a versioned, public-access-prevented GCS bucket before the first initialization. This module declares the GCS backend but intentionally does not guess a globally unique bucket name. Even though secret payloads are excluded, state still contains infrastructure metadata and should be access-controlled.

```sh
export TF_STATE_BUCKET=autovet-terraform-state-647145801184
gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
  --project=autovet \
  --location=asia-east1 \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning

terraform init \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="prefix=autovet/production"
```

## First deployment and secret bootstrap

Cloud Run validates referenced Secret Manager versions while creating a revision. Because Terraform creates containers but not payloads, the first deployment is intentionally two-stage.

1. Initialize and create the foundational resources:

   ```sh
   terraform fmt -check
   terraform validate
   terraform apply \
     -target='google_project_service.required' \
     -target='google_sql_database_instance.postgres' \
     -target='google_sql_database.app' \
     -target='google_sql_user.runtime' \
     -target='google_sql_user.migration' \
     -target='google_secret_manager_secret.app' \
     -target='google_service_account.app'
   ```

2. Run the interactive bootstrap:

   ```sh
   ./scripts/bootstrap-secrets.sh
   ```

   The script:

   - sets the PostgreSQL administrator, runtime, and migration passwords through the Cloud SQL Admin API;
   - connects through Cloud SQL Auth Proxy and applies database grants;
   - builds Unix-socket database URLs locally;
   - adds one version to the Secret Manager containers Cloud Run still consumes (`database-url-runtime`, `database-url-migration`, `auth-secret`, and `openai-api-key`). Unused `admin-email` and `admin-password-hash` containers may remain from earlier deploys.

   Inputs are read without terminal echo. They are not passed to Terraform or written to files. `gcloud sql users set-password` necessarily receives each database password as a process argument for the duration of that command, so run the script only on a trusted workstation. The PostgreSQL administrator password is not stored by the module; retain it securely or reset it with the Cloud SQL Admin API when needed.

3. Reconcile the complete graph:

   ```sh
   terraform apply
   ```

Targeted apply is only a one-time bootstrap mechanism. Always finish with a normal apply.

## Delivery behavior

The initial service and job use Google's Cloud Run hello image as a harmless placeholder. The migration job is not runnable until CI replaces that image with the image built from the Dockerfile's migration target. Terraform ignores subsequent image changes for both resources so deployments are not rolled back by infrastructure applies.

The GitHub identities are intentionally separate:

- `autovet-github-deployer` accepts only the GitHub OIDC subject for `DiegoWu/autoVet` on `refs/heads/main`. It can push images, update Cloud Run resources, and act as the two runtime service accounts.
- `autovet-github-migrations` accepts only the subject for the configured protected GitHub environment (default `production`). It can invoke the migration job but cannot update it or impersonate a runtime identity.
- `autovet-terraform` uses that same protected-environment provider for manually approved infrastructure applies and is never used by the application delivery workflow.

Use the `github_main_workload_identity_provider`, `github_environment_workload_identity_provider`, and `service_account_emails` outputs in workflows.

## Operational caveats

- Cloud SQL has a public address but accepts no authorized networks. `connector_enforcement = "REQUIRED"` limits connections to Cloud SQL connectors, including the Auth Proxy and Cloud Run Unix socket attachment.
- Database deletion protection defaults to enabled at both Terraform and Cloud SQL API layers. Disable it explicitly and apply before intentionally destroying the instance.
- Runtime database permissions are granted through migration-role default privileges. Run all schema migrations as the migration user; objects created by another owner need equivalent grants.
- Secret rotation is out of band: add a new Secret Manager version, update its numeric entry in `secret_versions`, and apply Terraform to create a revision pinned to that version.
- The Terraform provisioner service account is created by this module, so an administrator identity must perform the initial apply. Grant humans or CI permission to impersonate it separately according to your organization policy; no broad external principal is attached here.
- Enabling Cloud Scheduler creates Google's service agent and its service-agent role. Do not remove that Google-managed binding, because it signs Scheduler OIDC tokens.
