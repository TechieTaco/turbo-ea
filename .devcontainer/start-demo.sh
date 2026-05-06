#!/usr/bin/env bash
# postStartCommand for Codespaces — runs every time the codespace starts,
# including after a stop/resume. The dockerd from the docker-in-docker
# feature starts fresh on each boot, so we re-up the compose stack to
# bring containers back online.
set -uo pipefail

cd "$(dirname "$0")/.."

# If .env doesn't exist, the postCreateCommand hasn't completed yet —
# nothing to start.
if [ ! -f .env ]; then
  echo "No .env yet — skipping (postCreateCommand still running)."
  exit 0
fi

echo "Ensuring Turbo EA containers are running..."
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d
