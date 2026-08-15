variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
  default     = "autovet"
}

variable "project_number" {
  description = "Google Cloud project number. Kept explicit so WIF principal URIs are stable during planning."
  type        = string
  default     = "647145801184"

  validation {
    condition     = can(regex("^[0-9]+$", var.project_number))
    error_message = "project_number must contain digits only."
  }
}

variable "region" {
  description = "Default region for regional resources."
  type        = string
  default     = "asia-east1"
}

variable "resource_prefix" {
  description = "Prefix used for resource IDs."
  type        = string
  default     = "autovet"
}

variable "github_repository" {
  description = "GitHub repository allowed to federate, in owner/name format."
  type        = string
  default     = "DiegoWu/autoVet"
}

variable "github_repository_id" {
  description = "Immutable GitHub repository ID allowed to federate."
  type        = string
  default     = "1330397629"
}

variable "github_repository_owner_id" {
  description = "Immutable GitHub repository owner ID allowed to federate."
  type        = string
  default     = "85223569"
}

variable "github_environment" {
  description = "Protected GitHub environment allowed to execute migrations."
  type        = string
  default     = "production"
}

variable "database_name" {
  description = "Application PostgreSQL database name."
  type        = string
  default     = "autovet"
}

variable "database_runtime_user" {
  description = "PostgreSQL role used by the running application."
  type        = string
  default     = "autovet_runtime"
}

variable "database_migration_user" {
  description = "PostgreSQL role used only by migration jobs."
  type        = string
  default     = "autovet_migration"
}

variable "database_tier" {
  description = "Cloud SQL machine tier for the Enterprise edition. Enterprise Plus requires db-perf-optimized-N-* instead."
  type        = string
  default     = "db-custom-1-3840"
}

variable "database_disk_size_gb" {
  description = "Initial Cloud SQL SSD size in GiB."
  type        = number
  default     = 20
}

variable "database_deletion_protection" {
  description = "Protect the Cloud SQL instance from Terraform and API deletion."
  type        = bool
  default     = true
}

variable "placeholder_image" {
  description = "Bootstrap image only. Delivery workflows replace it; Terraform ignores later image changes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "app_cpu" {
  description = "Cloud Run CPU limit."
  type        = string
  default     = "2"
}

variable "app_memory" {
  description = "Cloud Run memory limit."
  type        = string
  default     = "1Gi"
}

variable "app_concurrency" {
  description = "Maximum concurrent requests per Cloud Run instance."
  type        = number
  default     = 4
}

variable "app_max_instances" {
  description = "Maximum number of Cloud Run service instances."
  type        = number
  default     = 3
}

variable "app_cpu_utilization" {
  description = "Cloud Run CPU utilization target before scaling out. Use 0.1–0.95, or 0 to disable CPU-based scaling. Preview scaling-controls field."
  type        = number
  default     = 0.6

  validation {
    condition     = var.app_cpu_utilization == 0 || (var.app_cpu_utilization >= 0.1 && var.app_cpu_utilization <= 0.95)
    error_message = "app_cpu_utilization must be 0 (disabled) or between 0.1 and 0.95."
  }
}

variable "app_concurrency_utilization" {
  description = "Cloud Run concurrency utilization target before scaling out. Use 0.1–0.95, or 0 to disable concurrency-based scaling. Preview scaling-controls field."
  type        = number
  default     = 0.6

  validation {
    condition     = var.app_concurrency_utilization == 0 || (var.app_concurrency_utilization >= 0.1 && var.app_concurrency_utilization <= 0.95)
    error_message = "app_concurrency_utilization must be 0 (disabled) or between 0.1 and 0.95."
  }
}

variable "scheduler_timezone" {
  description = "Timezone used by the five-minute keepalive schedule."
  type        = string
  default     = "Asia/Taipei"
}

variable "secret_versions" {
  description = "Pinned Secret Manager versions deployed to Cloud Run. Increment entries explicitly during rotation."
  type        = map(string)
  default = {
    auth-secret            = "1"
    database-url-migration = "1"
    database-url-runtime   = "1"
    openai-api-key         = "1"
  }

  validation {
    condition = alltrue([
      for secret_id in [
        "auth-secret",
        "database-url-migration",
        "database-url-runtime",
        "openai-api-key",
      ] : can(regex("^[1-9][0-9]*$", var.secret_versions[secret_id]))
    ])
    error_message = "Every managed secret must use an explicit positive numeric version."
  }
}
