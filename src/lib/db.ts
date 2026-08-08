import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const base = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query'],
})

// ────────────────────────────────────────────────────────────────────────────
// TECHNICAL DEBT — C-5 / P2-2: Decimal → number coercion.
//
// This `$extends` block globally coerces every monetary `Decimal` column to
// JS `number` on read. IEEE-754 doubles CANNOT exactly represent most
// decimal values (e.g. 0.1 + 0.2 = 0.30000000000000004), so this coercion
// silently loses precision on every read. The audit (C-5) flags this as a
// correctness defect; the fix (P2-2) is to migrate every consumer to the
// BigInt `Money` type (`src/money/money.ts`) which stores minor units as
// BigInt (exact).
//
// We CANNOT remove the whole block in one commit — 100+ call sites assume
// `payment.amount` / `wallet.balance` / `payout.fee` etc. are `number`.
// P2-2 removes the coercion field-by-field as each consumer is migrated.
//
// MIGRATED (P2-2): `payment.fee` + `payment.netAmount` — removed below.
//   Consumers of these two fields now receive a Prisma.Decimal and must
//   rehydrate via `Money.fromDecimal(row.fee, currency)`. The producer
//   side (`paymentService.create` / `PaymentCommandHandler`) now computes
//   these values with `Money.mulBps` + `Money.subtract` (exact BigInt),
//   so the persisted value is exact; the read side preserves that
//   precision instead of collapsing it to float.
//
// TODO(P2-2-followup): remove the rest of this block once the remaining
// 1601 number-typed money fields are migrated to Money. Tracked by the
// `payswap-money/no-number-money-fields` ESLint rule (added P2-2 Part D).
// ────────────────────────────────────────────────────────────────────────────
export const db = base.$extends({
  result: {
    wallet: {
      balance: { needs: { balance: true }, compute(w: any) { return Number(w.balance) } },
      pendingBalance: { needs: { pendingBalance: true }, compute(w: any) { return Number(w.pendingBalance) } },
      lockedBalance: { needs: { lockedBalance: true }, compute(w: any) { return Number(w.lockedBalance) } },
    },
    walletTransaction: {
      amount: { needs: { amount: true }, compute(w: any) { return Number(w.amount) } },
    },
    payment: {
      amount: { needs: { amount: true }, compute(p: any) { return Number(p.amount) } },
      // P2-2 (C-5): fee + netAmount NO LONGER coerced — consumers receive
      // Prisma.Decimal and should rehydrate via Money.fromDecimal. The
      // producer (paymentService + PaymentCommandHandler) now writes
      // exact BigInt-derived values; the read side preserves them.
      // fee: { needs: { fee: true }, compute(p: any) { return Number(p.fee) } },
      // netAmount: { needs: { netAmount: true }, compute(p: any) { return Number(p.netAmount) } },
      fxRate: { needs: { fxRate: true }, compute(p: any) { return Number(p.fxRate) } },
    },
    payout: {
      sourceAmount: { needs: { sourceAmount: true }, compute(p: any) { return Number(p.sourceAmount) } },
      // P2-2 followup (C-5, regrade 2026-08-08): fee + netAmount NO LONGER
      // coerced — same migration already done for `payment.fee`/
      // `netAmount` above. `src/services/payout-service.ts` now computes
      // these with `Money.mulBps` + `Money.subtract` (exact BigInt); this
      // coercion was silently truncating that exact value back to float
      // on every read. Consumers receive a Prisma.Decimal and should
      // rehydrate via `Money.fromDecimal`, or `Number(...)` for display
      // formatting only (verified: all current UI consumers already wrap
      // with `Number(payout.fee)` defensively).
      // fee: { needs: { fee: true }, compute(p: any) { return Number(p.fee) } },
      // netAmount: { needs: { netAmount: true }, compute(p: any) { return Number(p.netAmount) } },
      fxRate: { needs: { fxRate: true }, compute(p: any) { return Number(p.fxRate) } },
    },
    refund: {
      amount: { needs: { amount: true }, compute(r: any) { return Number(r.amount) } },
    },
    invoice: {
      subtotal: { needs: { subtotal: true }, compute(i: any) { return Number(i.subtotal) } },
      tax: { needs: { tax: true }, compute(i: any) { return Number(i.tax) } },
      total: { needs: { total: true }, compute(i: any) { return Number(i.total) } },
      amountPaid: { needs: { amountPaid: true }, compute(i: any) { return Number(i.amountPaid) } },
    },
    product: {
      price: { needs: { price: true }, compute(p: any) { return Number(p.price) } },
    },
    paymentLink: {
      amount: { needs: { amount: true }, compute(p: any) { return Number(p.amount) } },
      totalCollected: { needs: { totalCollected: true }, compute(p: any) { return Number(p.totalCollected) } },
    },
    lPProfile: {
      stake: { needs: { stake: true }, compute(l: any) { return Number(l.stake) } },
      collateral: { needs: { collateral: true }, compute(l: any) { return Number(l.collateral) } },
      capacity: { needs: { capacity: true }, compute(l: any) { return Number(l.capacity) } },
      feeBps: { needs: { feeBps: true }, compute(l: any) { return Number(l.feeBps) } },
      settlementSpeedMs: { needs: { settlementSpeedMs: true }, compute(l: any) { return Number(l.settlementSpeedMs) } },
      reputation: { needs: { reputation: true }, compute(l: any) { return Number(l.reputation) } },
      bond: { needs: { bond: true }, compute(l: any) { return Number(l.bond) } },
    },
    customerRecord: {
      totalSpent: { needs: { totalSpent: true }, compute(c: any) { return Number(c.totalSpent) } },
    },
    customer: {
      totalSpent: { needs: { totalSpent: true }, compute(c: any) { return Number(c.totalSpent) } },
    },
    aMLAlert: {
      score: { needs: { score: true }, compute(a: any) { return Number(a.score) } },
    },
    sAR: {
      amount: { needs: { amount: true }, compute(s: any) { return Number(s.amount) } },
    },
    subscription: {
      amount: { needs: { amount: true }, compute(s: any) { return Number(s.amount) } },
    },
    simulationRun: {
      amount: { needs: { amount: true }, compute(s: any) { return Number(s.amount) } },
      baselineCost: { needs: { baselineCost: true }, compute(s: any) { return Number(s.baselineCost) } },
      costPercent: { needs: { costPercent: true }, compute(s: any) { return Number(s.costPercent) } },
      riskScore: { needs: { riskScore: true }, compute(s: any) { return Number(s.riskScore) } },
      baselineRisk: { needs: { baselineRisk: true }, compute(s: any) { return Number(s.baselineRisk) } },
      baselineConf: { needs: { baselineConf: true }, compute(s: any) { return Number(s.baselineConf) } },
      confidence: { needs: { confidence: true }, compute(s: any) { return Number(s.confidence) } },
    },
    ledgerEntryRecord: {
      debit: { needs: { debit: true }, compute(l: any) { return Number(l.debit) } },
      credit: { needs: { credit: true }, compute(l: any) { return Number(l.credit) } },
      balanceAfter: { needs: { balanceAfter: true }, compute(l: any) { return Number(l.balanceAfter) } },
    },
    twinTokenRecord: {
      amount: { needs: { amount: true }, compute(t: any) { return Number(t.amount) } },
    },
    extension: {
      price: { needs: { price: true }, compute(e: any) { return Number(e.price) } },
      rating: { needs: { rating: true }, compute(e: any) { return Number(e.rating) } },
    },
    savedScenarioRecord: {
      baselineCost: { needs: { baselineCost: true }, compute(s: any) { return Number(s.baselineCost) } },
    },
  },
})

if (process.env.NODE_ENV !== 'production') {
  (globalForPrisma as any).prisma = base
}

export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v !== null && 'toNumber' in v) return (v as any).toNumber()
  return Number(v)
}
