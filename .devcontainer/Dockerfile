FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ARG CLOUD_SQL_PROXY_VERSION=2.25.2

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    jq \
    lsb-release \
    openssl \
    python3 \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/postgresql.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    google-cloud-cli \
    postgresql-client-17 \
  && architecture="$(dpkg --print-architecture)" \
  && case "${architecture}" in \
    amd64) proxy_sha256="43950f9500d2a34cd3b7e0ed89508f66b8eac4a5f9303c7bd2c18fb4bff32e10" ;; \
    arm64) proxy_sha256="1fcbd5392261e04b8453bad98901b19c94e731723f62e273b1139b1c1f8b7982" ;; \
    *) echo "Unsupported Cloud SQL Proxy architecture: ${architecture}" >&2; exit 1 ;; \
  esac \
  && proxy_url="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v${CLOUD_SQL_PROXY_VERSION}/cloud-sql-proxy.linux.${architecture}" \
  && curl -fsSL "${proxy_url}" -o /usr/local/bin/cloud-sql-proxy \
  && echo "${proxy_sha256}  /usr/local/bin/cloud-sql-proxy" | sha256sum --check --strict \
  && chmod 0755 /usr/local/bin/cloud-sql-proxy \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

USER node
