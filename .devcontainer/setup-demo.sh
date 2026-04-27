#!/usr/bin/env bash
# postCreateCommand for Codespaces — runs once when the codespace is created.
# Generates .env, builds the images, and brings up the demo stack.
#
# Note: don't use `set -e` here. We want the script to keep going on
# transient failures and surface diagnostics rather than silently exiting
# with the postCreateCommand still marked "successful".
set -uo pipefail

cd "$(dirname "$0")/.."

echo "======================================"
echo "  Turbo EA Demo — Setting up..."
echo "======================================"

# Generate .env if missing. Re-running the script preserves the existing
# secret so cached JWTs continue to validate.
if [ ! -f .env ]; then
  SECRET_KEY=$(openssl rand -base64 48)
  POSTGRES_PASSWORD=$(openssl rand -base64 24)
  cat > .env <<EOF
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SECRET_KEY=${SECRET_KEY}
ACCESS_TOKEN_EXPIRE_MINUTES=1440
ENVIRONMENT=development
ALLOWED_ORIGINS=*
HOST_PORT=8920
SEED_DEMO=true
EOF
  echo "Generated .env with demo configuration."
else
  echo "Existing .env detected — keeping current secrets."
fi

# Build and start all services.
echo "Building and starting containers (this may take 5–10 minutes on first run)..."
if ! docker compose -f docker-compose.db.yml up --build -d; then
  echo "ERROR: docker compose up failed. Run 'docker compose -f docker-compose.db.yml logs' for details."
  exit 1
fi

# Wait for the full chain (nginx :8920 → backend :8000 → db) to respond.
# Hitting the forwarded port from the host validates exactly what the
# user's browser hits, so a healthy result here means port 8920 will not
# 502 when opened. Up to 8 minutes — first run with SEED_DEMO is slow on
# 2-core Codespaces.
echo "Waiting for Turbo EA to be ready on http://localhost:8920 ..."
ready=0
for i in $(seq 1 240); do
  if curl -sf -o /dev/null -m 3 "http://localhost:8920/api/health"; then
    ready=1
    break
  fi
  if [ $((i % 15)) -eq 0 ]; then
    echo "  ... still waiting ($((i * 2))s elapsed)"
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo ""
  echo "WARNING: Turbo EA did not respond on port 8920 within 8 minutes."
  echo "         Containers are still running and may finish starting shortly."
  echo "         Check status with:"
  echo "           docker compose -f docker-compose.db.yml ps"
  echo "           docker compose -f docker-compose.db.yml logs --tail=200"
  exit 0
fi

echo ""
echo "======================================"
echo "  Turbo EA Demo is running!"
echo "======================================"
echo ""
echo "  Open the forwarded port 8920 in your browser."
echo ""
echo "  Login credentials:"
echo "    Email:    admin@turboea.demo"
echo "    Password: TurboEA!2025"
echo ""
echo "  Useful commands:"
echo "    docker compose -f docker-compose.db.yml logs -f    # View logs"
echo "    docker compose -f docker-compose.db.yml down       # Stop demo"
echo "    docker compose -f docker-compose.db.yml restart    # Restart"
echo ""
