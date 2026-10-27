#!/usr/bin/env bash
# Stop FinAlly (macOS/Linux). Keeps the finally-data volume, so your data persists.
# Safe to run more than once.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

status=0
docker compose down || status=$?
if [ "$status" -ne 0 ]; then
  echo "docker compose down failed (exit $status). Is Docker running?" >&2
  exit "$status"
fi

echo "FinAlly stopped. Your data is kept in the finally-data volume."
