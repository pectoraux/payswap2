import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Helper: convert Prisma Decimal to number.
 * Use this when reading monetary values from aggregation queries or
 * include relations where the $extends result extension doesn't apply.
 *
 * Example:
 *   const agg = await db.payment.aggregate({ _sum: { amount: true } })
 *   const total = toNumber(agg._sum.amount)
 */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber()
  }
  return Number(v)
}
