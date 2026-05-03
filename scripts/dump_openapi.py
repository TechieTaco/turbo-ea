#!/usr/bin/env python3
"""Dump the FastAPI OpenAPI schema to a static JSON file.

The output is committed to ``docs/api/openapi.json`` and rendered by Scalar in
the user manual (``docs/admin/api.md``). Calling ``app.openapi()`` only walks
the registered routers — the lifespan (DB migrations, seeding, Ollama pulls)
does **not** run here.

Usage (from the repo root):

    python scripts/dump_openapi.py [output_path]

The default output path is ``docs/api/openapi.json``. CI uses a temp path and
diffs against the committed file to detect drift.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "api" / "openapi.json"

# Safe defaults so importing app.main does not trip on env-var validation.
# These never reach a real DB or network — the lifespan is not invoked.
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_DB", "turboea")
os.environ.setdefault("POSTGRES_USER", "turboea")
os.environ.setdefault("POSTGRES_PASSWORD", "turboea")

if BACKEND_DIR.is_dir():
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    schema = app.openapi()
    with output.open("w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=2, sort_keys=True)
        fh.write("\n")
    paths = len(schema.get("paths", {}))
    version = schema.get("info", {}).get("version", "unknown")
    print(f"Wrote {output} ({paths} paths, version {version})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
