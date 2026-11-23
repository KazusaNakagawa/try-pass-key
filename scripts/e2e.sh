#!/usr/bin/env bash
# Runs the E2E suite against a throwaway stack: its own compose project name,
# volumes and port. It never writes test users into the development database,
# and never recreates the development containers (which a plain
# `docker compose --profile e2e run e2e` with a different WEB_PORT would do).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

export COMPOSE_PROJECT_NAME=try-pass-key-e2e
export WEB_PORT="${E2E_WEB_PORT:-5199}"

cleanup() {
  docker compose --profile e2e down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose up -d --wait
docker compose --profile e2e run --rm e2e
