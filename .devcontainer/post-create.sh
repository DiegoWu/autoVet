#!/usr/bin/env bash
set -euo pipefail

cache_directories=(
  "/home/node/.cache/ms-playwright"
  "/home/node/.config/gcloud"
  "/home/node/.npm"
  "/home/node/.terraform.d/plugin-cache"
  "${PWD}/node_modules"
)

sudo mkdir -p "${cache_directories[@]}"
sudo chown -R "$(id -u):$(id -g)" "${cache_directories[@]}"

npm ci
npm run db:generate

npx playwright install --with-deps chromium

terraform -chdir=infra/terraform init -backend=false

node --version
npm --version
terraform version
gcloud version
psql --version
cloud-sql-proxy --version
docker version
