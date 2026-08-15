locals {
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ])

  service_accounts = {
    app_runtime = {
      account_id   = "${var.resource_prefix}-app-runtime"
      display_name = "autoVet application runtime"
    }
    migration_runtime = {
      account_id   = "${var.resource_prefix}-migration-runtime"
      display_name = "autoVet migration runtime"
    }
    scheduler = {
      account_id   = "${var.resource_prefix}-scheduler"
      display_name = "autoVet Cloud Scheduler caller"
    }
    github_deployer = {
      account_id   = "${var.resource_prefix}-github-deployer"
      display_name = "autoVet GitHub deployment principal"
    }
    github_migration_executor = {
      account_id   = "${var.resource_prefix}-github-migrations"
      display_name = "autoVet GitHub migration executor"
    }
    terraform_provisioner = {
      account_id   = "${var.resource_prefix}-terraform"
      display_name = "autoVet Terraform provisioner"
    }
  }

  secret_ids = toset([
    "database-url-runtime",
    "database-url-migration",
    "auth-secret",
    "admin-email",
    "admin-password-hash",
    "openai-api-key",
  ])

  app_secret_ids = toset([
    "database-url-runtime",
    "auth-secret",
    "admin-email",
    "admin-password-hash",
    "openai-api-key",
  ])

  terraform_provisioner_roles = toset([
    "roles/artifactregistry.admin",
    "roles/cloudscheduler.admin",
    "roles/cloudsql.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
  ])

  github_main_subject        = "repo:${var.github_repository}:ref:refs/heads/main"
  github_environment_subject = "repo:${var.github_repository}:environment:${var.github_environment}"
  wif_principal_prefix       = "principal://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/subject"
  wif_principal_set_prefix      = "principalSet://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}"
  wif_principal_set_main_ref    = "${local.wif_principal_set_prefix}/attribute.ref/refs/heads/main"
  wif_principal_set_environment = "${local.wif_principal_set_prefix}/attribute.environment/${var.github_environment}"
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = var.resource_prefix
  description   = "autoVet application and migration images"
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-older-than-30-days"
    action = "DELETE"

    condition {
      tag_state  = "ANY"
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = "${var.resource_prefix}-postgres"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = var.database_deletion_protection

  settings {
    edition           = "ENTERPRISE"
    tier              = var.database_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.database_disk_size_gb
    disk_autoresize   = true

    deletion_protection_enabled = var.database_deletion_protection
    connector_enforcement       = "REQUIRED"

    backup_configuration {
      enabled                        = true
      start_time                     = "18:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 19
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }
  }

  depends_on = [google_project_service.required["sqladmin.googleapis.com"]]
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = var.database_name
}

# Cloud SQL for PostgreSQL requires a password at user creation. These
# write-only values are disposable bootstrap secrets: they are not stored in
# Terraform state. bootstrap-secrets.sh immediately replaces them.
ephemeral "random_password" "runtime" {
  length  = 32
  special = false
}

ephemeral "random_password" "migration" {
  length  = 32
  special = false
}

resource "google_sql_user" "runtime" {
  project             = var.project_id
  instance            = google_sql_database_instance.postgres.name
  name                = var.database_runtime_user
  password_wo         = ephemeral.random_password.runtime.result
  password_wo_version = 1
}

resource "google_sql_user" "migration" {
  project             = var.project_id
  instance            = google_sql_database_instance.postgres.name
  name                = var.database_migration_user
  password_wo         = ephemeral.random_password.migration.result
  password_wo_version = 1
}

resource "google_secret_manager_secret" "app" {
  for_each = local.secret_ids

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_service_account" "app" {
  for_each = local.service_accounts

  project      = var.project_id
  account_id   = each.value.account_id
  display_name = each.value.display_name

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_project_iam_member" "app_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app["app_runtime"].email}"
}

resource "google_project_iam_member" "migration_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app["migration_runtime"].email}"
}

resource "google_secret_manager_secret_iam_member" "app_runtime" {
  for_each = local.app_secret_ids

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app["app_runtime"].email}"
}

resource "google_secret_manager_secret_iam_member" "migration_runtime" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.app["database-url-migration"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app["migration_runtime"].email}"
}

resource "google_artifact_registry_repository_iam_member" "github_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.app["github_deployer"].email}"
}

resource "google_project_iam_member" "github_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.app["github_deployer"].email}"
}

resource "google_service_account_iam_member" "github_deployer_act_as_runtime" {
  for_each = toset(["app_runtime", "migration_runtime"])

  service_account_id = google_service_account.app[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.app["github_deployer"].email}"
}

resource "google_service_account_iam_member" "github_deployer_self_token" {
  service_account_id = google_service_account.app["github_deployer"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app["github_deployer"].email}"
}

resource "google_service_account_iam_member" "github_deployer_wif_token" {
  service_account_id = google_service_account.app["github_deployer"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.wif_principal_set_main_ref
}

resource "google_service_account_iam_member" "github_migration_self_token" {
  service_account_id = google_service_account.app["github_migration_executor"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app["github_migration_executor"].email}"
}

resource "google_service_account_iam_member" "github_migration_wif_token" {
  service_account_id = google_service_account.app["github_migration_executor"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.wif_principal_set_environment
}

resource "google_service_account_iam_member" "terraform_self_token" {
  service_account_id = google_service_account.app["terraform_provisioner"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app["terraform_provisioner"].email}"
}

resource "google_service_account_iam_member" "terraform_wif_token" {
  service_account_id = google_service_account.app["terraform_provisioner"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.wif_principal_set_environment
}

resource "google_project_iam_member" "terraform_provisioner" {
  for_each = local.terraform_provisioner_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app["terraform_provisioner"].email}"
}

resource "google_service_account_iam_member" "terraform_provisioner_act_as" {
  for_each = toset(["app_runtime", "migration_runtime", "scheduler"])

  service_account_id = google_service_account.app[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.app["terraform_provisioner"].email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${var.resource_prefix}-github"
  display_name              = "autoVet GitHub Actions"
  description               = "GitHub Actions identities for ${var.github_repository}"

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github_main" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-main"
  display_name                       = "GitHub main branch"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_iam_workload_identity_pool_provider" "github_environment" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-environment"
  display_name                       = "GitHub protected environment"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.environment"         = "assertion.environment"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}' && assertion.environment == '${var.github_environment}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_main_wif" {
  service_account_id = google_service_account.app["github_deployer"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_set_main_ref
}

resource "google_service_account_iam_member" "github_environment_wif" {
  service_account_id = google_service_account.app["github_migration_executor"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_set_environment
}

resource "google_service_account_iam_member" "terraform_environment_wif" {
  service_account_id = google_service_account.app["terraform_provisioner"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_set_environment
}

resource "google_cloud_run_v2_service" "app" {
  project             = var.project_id
  name                = "${var.resource_prefix}-app"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.app["app_runtime"].email
    max_instance_request_concurrency = var.app_concurrency
    timeout                          = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.app_max_instances
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }

    containers {
      image = var.placeholder_image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.app_cpu
          memory = var.app_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["database-url-runtime"].secret_id
            version = var.secret_versions["database-url-runtime"]
          }
        }
      }

      env {
        name = "AUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["auth-secret"].secret_id
            version = var.secret_versions["auth-secret"]
          }
        }
      }

      env {
        name = "ADMIN_EMAIL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["admin-email"].secret_id
            version = var.secret_versions["admin-email"]
          }
        }
      }

      env {
        name = "ADMIN_PASSWORD_HASH"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["admin-password-hash"].secret_id
            version = var.secret_versions["admin-password-hash"]
          }
        }
      }

      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["openai-api-key"].secret_id
            version = var.secret_versions["openai-api-key"]
          }
        }
      }

      env {
        name  = "AUTH_SESSION_TTL_SECONDS"
        value = "43200"
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 24

        http_get {
          path = "/api/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 10
        failure_threshold     = 3

        http_get {
          path = "/api/health"
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_secret_manager_secret_iam_member.app_runtime,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migration" {
  project             = var.project_id
  name                = "${var.resource_prefix}-migrate"
  location            = var.region
  deletion_protection = false

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.app["migration_runtime"].email
      timeout         = "900s"
      max_retries     = 0

      volumes {
        name = "cloudsql"

        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }

      containers {
        image   = var.placeholder_image
        command = ["npm"]
        args    = ["run", "db:deploy"]

        resources {
          limits = {
            cpu    = var.app_cpu
            memory = var.app_memory
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["database-url-migration"].secret_id
              version = var.secret_versions["database-url-migration"]
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_secret_manager_secret_iam_member.migration_runtime,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "github_migration_executor" {
  project  = var.project_id
  location = google_cloud_run_v2_job.migration.location
  name     = google_cloud_run_v2_job.migration.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.app["github_migration_executor"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "scheduler" {
  project  = var.project_id
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.app["scheduler"].email}"
}

resource "google_cloud_scheduler_job" "ping" {
  project          = var.project_id
  region           = var.region
  name             = "${var.resource_prefix}-ping"
  description      = "Authenticated five-minute availability ping for autoVet"
  schedule         = "*/5 * * * *"
  time_zone        = var.scheduler_timezone
  attempt_deadline = "30s"

  retry_config {
    retry_count          = 1
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
    max_doublings        = 2
  }

  http_target {
    uri         = "${google_cloud_run_v2_service.app.uri}/api/health"
    http_method = "GET"

    oidc_token {
      service_account_email = google_service_account.app["scheduler"].email
      audience              = google_cloud_run_v2_service.app.uri
    }
  }

  depends_on = [
    google_project_service.required["cloudscheduler.googleapis.com"],
    google_cloud_run_v2_service_iam_member.scheduler,
  ]
}
