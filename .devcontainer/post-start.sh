#!/usr/bin/env bash
set -euo pipefail

for attempt in {1..30}; do
  if pg_isready --host=db --username=autovet --dbname=autovet >/dev/null 2>&1; then
    npm run db:deploy
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready within 30 seconds." >&2
exit 1
