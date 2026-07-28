#!/bin/bash
# PaySwap dev server launcher.
#
# This wrapper forces .env values to override any stale shell env vars
# (especially DATABASE_URL, which the sandbox shell sets to a SQLite file).
# Next.js's built-in .env loader does NOT override existing process.env
# values, so we must source .env explicitly here before starting next.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Force-load .env (overrides any existing shell env vars)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  . "$PROJECT_DIR/.env"
  set +a
fi

# Start the dev server (turbopack for lower memory usage)
exec bun next dev -p 3000 -H 0.0.0.0 2>&1 | tee "$PROJECT_DIR/dev.log"
