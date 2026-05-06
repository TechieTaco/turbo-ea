# Turbo EA Demo

The Codespace builds and starts the full Turbo EA stack with the NexaTech
demo dataset (including BPM and PPM data). Setup typically takes 5–10
minutes the first time the codespace is created.

Once the build finishes, **open the forwarded port `8920`** in your
browser (the *Ports* panel pops it open automatically the first time).

## Login credentials

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `admin@turboea.demo`   |
| Password | `TurboEA!2025`         |

## What's enabled

- NexaTech Industries demo metamodel + cards (`SEED_DEMO=true`)
- PPM module — initiatives, status reports, WBS, tasks, costs, risks
- BPM module — enabled by default, browse from the top nav

## Useful commands

Run from the repository root:

```bash
# Tail all logs
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml logs -f

# Restart the stack
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml restart

# Stop the stack
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml down

# Or use the Makefile shortcut
make up-dev
```

## Troubleshooting

If port 8920 returns 502:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml ps
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml logs --tail=200
```

The first-run database migrations + demo seed take a couple of minutes
even after containers are *Up* — give it a moment and refresh.
