#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

for command in terraform gcloud python3 cloud-sql-proxy psql pg_isready openssl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

tf_output() {
  terraform -chdir="${TF_DIR}" output -raw "$1"
}

add_secret_version() {
  local secret_id="$1"
  local payload="$2"
  printf '%s' "${payload}" |
    gcloud secrets versions add "${secret_id}" \
      --project="${PROJECT_ID}" \
      --data-file=- >/dev/null
  echo "Added a version to ${secret_id}."
}

read_required_secret() {
  local prompt="$1"
  local value
  read -r -s -p "${prompt}: " value
  echo >&2
  if [[ -z "${value}" ]]; then
    echo "${prompt} cannot be empty." >&2
    exit 1
  fi
  printf '%s' "${value}"
}

PROJECT_ID="$(tf_output project_id)"
INSTANCE_NAME="$(tf_output cloud_sql_instance_name)"
CONNECTION_NAME="$(tf_output cloud_sql_connection_name)"
DATABASE_NAME="$(tf_output database_name)"
RUNTIME_USER="$(tf_output database_runtime_user)"
MIGRATION_USER="$(tf_output database_migration_user)"

for identifier in "${DATABASE_NAME}" "${RUNTIME_USER}" "${MIGRATION_USER}"; do
  if [[ ! "${identifier}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Unsafe PostgreSQL identifier from Terraform output: ${identifier}" >&2
    exit 1
  fi
done

echo "Secrets are read without echo and are never passed to Terraform."
POSTGRES_PASSWORD="$(read_required_secret "Temporary Cloud SQL postgres administrator password")"
RUNTIME_PASSWORD="$(read_required_secret "Runtime database password")"
MIGRATION_PASSWORD="$(read_required_secret "Migration database password")"
ADMIN_EMAIL="$(read_required_secret "Application administrator email")"
ADMIN_PASSWORD_HASH="$(read_required_secret "Precomputed bcrypt administrator password hash")"
read -r -s -p "OpenAI API key (optional): " OPENAI_API_KEY
echo

read -r -s -p "AUTH_SECRET (leave blank to generate 48 random bytes): " AUTH_SECRET
echo
if [[ -z "${AUTH_SECRET}" ]]; then
  AUTH_SECRET="$(openssl rand -base64 48)"
fi

echo "Setting database passwords through the Cloud SQL Admin API..."
gcloud sql users set-password postgres \
  --project="${PROJECT_ID}" \
  --instance="${INSTANCE_NAME}" \
  --password="${POSTGRES_PASSWORD}" >/dev/null
gcloud sql users set-password "${RUNTIME_USER}" \
  --project="${PROJECT_ID}" \
  --instance="${INSTANCE_NAME}" \
  --password="${RUNTIME_PASSWORD}" >/dev/null
gcloud sql users set-password "${MIGRATION_USER}" \
  --project="${PROJECT_ID}" \
  --instance="${INSTANCE_NAME}" \
  --password="${MIGRATION_PASSWORD}" >/dev/null

PROXY_LOG="$(mktemp)"
cloud-sql-proxy \
  --address=127.0.0.1 \
  --port=5433 \
  "${CONNECTION_NAME}" >"${PROXY_LOG}" 2>&1 &
PROXY_PID=$!

cleanup() {
  kill "${PROXY_PID}" >/dev/null 2>&1 || true
  wait "${PROXY_PID}" 2>/dev/null || true
  rm -f "${PROXY_LOG}"
  unset POSTGRES_PASSWORD RUNTIME_PASSWORD MIGRATION_PASSWORD AUTH_SECRET
}
trap cleanup EXIT

for _ in {1..30}; do
  if pg_isready -h 127.0.0.1 -p 5433 -d "${DATABASE_NAME}" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${PROXY_PID}" >/dev/null 2>&1; then
    echo "Cloud SQL Auth Proxy exited unexpectedly:" >&2
    sed 's/^/  /' "${PROXY_LOG}" >&2
    exit 1
  fi
  sleep 1
done

if ! pg_isready -h 127.0.0.1 -p 5433 -d "${DATABASE_NAME}" >/dev/null 2>&1; then
  echo "Timed out waiting for Cloud SQL Auth Proxy." >&2
  exit 1
fi

echo "Applying least-privilege database grants..."
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  --host=127.0.0.1 \
  --port=5433 \
  --username=postgres \
  --dbname="${DATABASE_NAME}" \
  --set=ON_ERROR_STOP=1 <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE "${DATABASE_NAME}" TO "${MIGRATION_USER}", "${RUNTIME_USER}";
GRANT USAGE, CREATE ON SCHEMA public TO "${MIGRATION_USER}";
GRANT USAGE ON SCHEMA public TO "${RUNTIME_USER}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${RUNTIME_USER}";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${RUNTIME_USER}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${RUNTIME_USER}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "${RUNTIME_USER}";
SQL

encode_url_component() {
  printf '%s' "$1" |
    python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))'
}

ENCODED_RUNTIME_PASSWORD="$(encode_url_component "${RUNTIME_PASSWORD}")"
ENCODED_MIGRATION_PASSWORD="$(encode_url_component "${MIGRATION_PASSWORD}")"
ENCODED_SOCKET="$(encode_url_component "/cloudsql/${CONNECTION_NAME}")"

RUNTIME_DATABASE_URL="postgresql://${RUNTIME_USER}:${ENCODED_RUNTIME_PASSWORD}@localhost/${DATABASE_NAME}?host=${ENCODED_SOCKET}"
MIGRATION_DATABASE_URL="postgresql://${MIGRATION_USER}:${ENCODED_MIGRATION_PASSWORD}@localhost/${DATABASE_NAME}?host=${ENCODED_SOCKET}"

echo "Creating Secret Manager versions..."
add_secret_version "database-url-runtime" "${RUNTIME_DATABASE_URL}"
add_secret_version "database-url-migration" "${MIGRATION_DATABASE_URL}"
add_secret_version "auth-secret" "${AUTH_SECRET}"
add_secret_version "admin-email" "${ADMIN_EMAIL}"
add_secret_version "admin-password-hash" "${ADMIN_PASSWORD_HASH}"
add_secret_version "openai-api-key" "${OPENAI_API_KEY}"

echo "Bootstrap complete. Run a normal terraform apply to create Cloud Run resources."
