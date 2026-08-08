/**
 * Bun test preload — loads `.env` with `override: true` before any test
 * module is evaluated.
 *
 * Why: the sandbox shell exports `DATABASE_URL=file:/home/z/my-project/db/custom.db`
 * (SQLite) but `prisma/schema.prisma` declares `provider = "postgresql"`. Bun's
 * built-in .env loader does NOT override existing process.env values, so without
 * this preload every test that touches the DB would fail with a Prisma schema
 * validation error. `dotenv.config({ override: true })` forces the .env values
 * (Neon Postgres URL) to win over the stale shell value.
 *
 * This file is referenced from `bunfig.toml`:
 *   [test]
 *   preload = ["./tests/setup.ts"]
 *
 * It applies to `bun test` invocations only — `bunx next dev` (the dev server)
 * is unaffected and still loads .env via the `set -a; . .env; set +a` wrapper
 * in `scripts/dev.sh`.
 */

import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({
  override: true,
  path: resolve(process.cwd(), '.env'),
});
