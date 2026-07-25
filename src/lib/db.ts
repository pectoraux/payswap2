import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Defensive env loader.
 *
 * The dev server is sometimes launched with a stale `DATABASE_URL` in the
 * shell environment (e.g. an old `file:./db/custom.db` SQLite URL) that
 * takes precedence over the value in `.env`. When the active schema provider
 * is `postgresql` but the resolved URL points at a SQLite file, Prisma fails
 * to initialise with a confusing "URL must start with postgresql://" error.
 *
 * To keep the runtime resilient we parse `.env` directly and, if it contains
 * a postgres URL, override the shell env before Prisma Client is constructed.
 * This is a no-op in production (where the platform injects the correct URL).
 */
function loadEnvOverrides() {
  const current = process.env.DATABASE_URL ?? ''
  const needsOverride = current.startsWith('file:') || current === ''
  if (!needsOverride) return

  try {
    const envPath = resolve(process.cwd(), '.env')
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      // Strip surrounding quotes (single or double) if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      // Only set keys we care about, and only if the .env value looks like a
      // postgres URL (so we don't accidentally clobber a working SQLite setup).
      if (
        (key === 'DATABASE_URL' || key === 'DIRECT_URL') &&
        value.startsWith('postgres')
      ) {
        process.env[key] = value
      }
    }
  } catch {
    // No .env file or unreadable — fall through and let Prisma surface its
    // own error.
  }
}

loadEnvOverrides()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
