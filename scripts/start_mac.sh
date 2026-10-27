#!/usr/bin/env bash
# Start FinAlly with docker compose (macOS/Linux). Safe to run more than once.
#
# Usage: ./scripts/start_mac.sh [--build] [--no-open]
#   --build    rebuild the image even if finally:latest already exists
#   --no-open  do not open the browser
set -euo pipefail

URL="http://localhost:8000"
WAIT_SECONDS=60

usage() {
  echo "Usage: $0 [--build] [--no-open]"
}

build=false
open_browser=true
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=true ;;
    --no-open) open_browser=false ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

# Run from the repo root (this script's parent directory), where docker-compose.yml lives.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

# First run: create .env from the template. Never overwrite an existing .env.
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "The market simulator needs no keys. To enable AI chat, set OPENROUTER_API_KEY in .env."
fi

if [ "$build" = false ] && ! docker image inspect finally:latest >/dev/null 2>&1; then
  build=true
fi

# Build as its own step, so build time never counts against the health timeout.
if [ "$build" = true ]; then
  echo "Building the FinAlly image..."
  status=0
  docker compose build || status=$?
  if [ "$status" -ne 0 ]; then
    echo "Docker build failed (exit $status). See the output above." >&2
    exit "$status"
  fi
fi

echo "Starting FinAlly..."
status=0
docker compose up -d --wait --wait-timeout "$WAIT_SECONDS" || status=$?
if [ "$status" -ne 0 ]; then
  docker compose logs --tail 50 app || true
  echo "FinAlly did not become healthy within $WAIT_SECONDS seconds. See the logs above." >&2
  exit 1
fi

echo "FinAlly is running at $URL"

if [ "$open_browser" = true ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    open "$URL" || echo "Open $URL in your browser."
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."
  else
    echo "Open $URL in your browser."
  fi
fi
