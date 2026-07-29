import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const base = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query'],
})

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
      fee: { needs: { fee: true }, compute(p: any) { return Number(p.fee) } },
      netAmount: { needs: { netAmount: true }, compute(p: any) { return Number(p.netAmount) } },
      fxRate: { needs: { fxRate: true }, compute(p: any) { return Number(p.fxRate) } },
    },
    payout: {
      sourceAmount: { needs: { sourceAmount: true }, compute(p: any) { return Number(p.sourceAmount) } },
      fee: { needs: { fee: true }, compute(p: any) { return Number(p.fee) } },
      netAmount: { needs: { netAmount: true }, compute(p: any) { return Number(p.netAmount) } },
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
