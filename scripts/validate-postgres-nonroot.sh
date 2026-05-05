#!/usr/bin/env bash

set -euo pipefail

IMAGE="${IMAGE:-postgres:18-alpine}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
POSTGRES_DB="${POSTGRES_DB:-turboea}"
POSTGRES_USER="${POSTGRES_USER:-turboea}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-turboea-test-password}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
VOLUME_NAME="${VOLUME_NAME:-turboea-postgres-native-test}"
CONTAINER_NAME="${CONTAINER_NAME:-turboea-postgres-native-test}"
WAIT_SECONDS="${WAIT_SECONDS:-20}"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Testing ${IMAGE} as ${APP_UID}:${APP_GID} with a fresh named volume..."
docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true

container_id=$(docker run -d \
    --name "$CONTAINER_NAME" \
    --user "${APP_UID}:${APP_GID}" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e PGDATA="$PGDATA" \
    -v "$VOLUME_NAME:$PGDATA" \
    "$IMAGE")

for _ in $(seq 1 "$WAIT_SECONDS"); do
    if ! docker inspect "$container_id" >/dev/null 2>&1; then
        echo "Container disappeared before readiness could be checked."
        exit 1
    fi

    running=$(docker inspect -f '{{.State.Running}}' "$container_id")
    if [[ "$running" != "true" ]]; then
        echo "FAIL: container exited before becoming ready."
        docker logs "$container_id" || true
        exit 1
    fi

    if docker exec "$container_id" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        echo "PASS: stock ${IMAGE} started successfully as ${APP_UID}:${APP_GID}."
        exit 0
    fi

    sleep 1
done

echo "FAIL: container never became ready within ${WAIT_SECONDS}s."
docker logs "$container_id" || true
exit 1