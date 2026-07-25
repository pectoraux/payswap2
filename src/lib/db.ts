import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// In production (Vercel), use /tmp for SQLite since the filesystem is read-only elsewhere
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.includes('/tmp/')) {
  process.env.DATABASE_URL = 'file:/tmp/payswap.db'
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
