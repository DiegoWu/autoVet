output "project_id" {
  description = "Google Cloud project ID."
  value       = var.project_id
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository resource name."
  value       = google_artifact_registry_repository.app.name
}

output "artifact_registry_image_prefix" {
  description = "Prefix to use when tagging application images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "cloud_sql_instance_name" {
  description = "Cloud SQL instance name used by the bootstrap script."
  value       = google_sql_database_instance.postgres.name
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name mounted at /cloudsql in Cloud Run."
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_name" {
  description = "Application database name."
  value       = google_sql_database.app.name
}

output "database_runtime_user" {
  description = "Application runtime database role."
  value       = google_sql_user.runtime.name
}

output "database_migration_user" {
  description = "Migration database role."
  value       = google_sql_user.migration.name
}

output "cloud_run_service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.app.name
}

output "cloud_run_service_uri" {
  description = "Public autoVet service URL."
  value       = google_cloud_run_v2_service.app.uri
}

output "cloud_run_migration_job_name" {
  description = "Cloud Run migration job name."
  value       = google_cloud_run_v2_job.migration.name
}

output "service_account_emails" {
  description = "Service account emails keyed by purpose."
  value       = { for key, account in google_service_account.app : key => account.email }
}

output "github_main_workload_identity_provider" {
  description = "Provider resource name for GitHub workflows running on main."
  value       = google_iam_workload_identity_pool_provider.github_main.name
}

output "github_environment_workload_identity_provider" {
  description = "Provider resource name for GitHub migration workflows using the protected environment."
  value       = google_iam_workload_identity_pool_provider.github_environment.name
}

output "secret_ids" {
  description = "Secret Manager containers that require out-of-band versions."
  value       = sort(tolist(local.secret_ids))
}
