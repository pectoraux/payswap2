#!/bin/bash
# Fully-detached dev server launcher — survives across shell sessions.
trap '' HUP TERM
cd /home/z/my-project
# Source .env so DATABASE_URL etc. override stale shell vars.
if [ -f .env ]; then set -a; . .env; set +a; fi
exec bunx next dev -p 3000 -H 0.0.0.0 --webpack > /home/z/my-project/dev.log 2>&1
