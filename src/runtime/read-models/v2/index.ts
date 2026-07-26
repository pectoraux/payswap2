/**
 * Read Models v2 — typed façades over Prisma that serve as the migration
 * bridge from direct Prisma access to runtime projections. (M-RT-17.)
 *
 * PRINCIPLE: pages and API routes read through these façades, not directly
 * from Prisma. This gives us:
 *   1. A single seam to swap Prisma reads for runtime projections later
 *   2. Typed return values (no leaking Prisma types to pages)
 *   3. Consistent caching/projection logic in one place
 *   4. A path to shadow mode (compare legacy vs projection-backed)
 */

import { db } from '@/lib/db';

// ─── Types (what pages receive — never Prisma types) ────────────────────────

export interface PaymentView {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  corridor: string;
  fee: number;
  netAmount: number;
  createdAt: Date;
  settledAt: Date | null;
  customerName: string | null;
  customerEmail: string | null;
}

export interface CustomerView {
  id: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  totalSpent: number;
  transactionCount: number;
  createdAt: Date;
}

export interface MerchantOverviewView {
  merchantId: string;
  merchantName: string;
  paymentCount: number;
  totalVolume: number;
  payoutCount: number;
  refundCount: number;
  customerCount: number;
  disputeCount: number;
}

export interface AdminOverviewView {
  merchantCount: number;
  userCount: number;
  paymentCount: number;
  totalVolume: number;
  pendingWaitlistCount: number;
  recentWaitlist: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    country: string;
    status: string;
    createdAt: Date;
  }[];
}

export interface AuditLogView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  details: string | null;
  userId: string | null;
  createdAt: Date;
}

// ─── Payment Read Model ─────────────────────────────────────────────────────

export const paymentReadModel = {
  async list(merchantId: string, opts?: { take?: number; skip?: number }): Promise<PaymentView[]> {
    const payments = await db.payment.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: opts?.take ?? 20,
      skip: opts?.skip ?? 0,
    });
    return payments.map(p => ({
      id: p.id,
      reference: p.reference ?? p.id.slice(0, 12),
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method ?? '—',
      corridor: p.corridor ?? '—',
      fee: p.fee,
      netAmount: p.netAmount,
      createdAt: p.createdAt,
      settledAt: p.settledAt,
      customerName: null,
      customerEmail: null,
    }));
  },

  async count(merchantId: string): Promise<number> {
    return db.payment.count({ where: { merchantId } });
  },

  async aggregateVolume(merchantId: string): Promise<number> {
    const agg = await db.payment.aggregate({
      where: { merchantId, status: 'COMPLETED' },
      _sum: { amount: true },
    });
    return agg._sum?.amount ?? 0;
  },
};

// ─── Customer Read Model ────────────────────────────────────────────────────

export const customerReadModel = {
  async list(merchantId: string, opts?: { take?: number }): Promise<CustomerView[]> {
    const customers = await db.customerRecord.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: opts?.take ?? 50,
    });
    return customers.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone ?? '',
      country: c.country ?? '',
      totalSpent: c.totalSpent,
      transactionCount: c.transactionCount,
      createdAt: c.createdAt,
    }));
  },

  async count(merchantId: string): Promise<number> {
    return db.customerRecord.count({ where: { merchantId } });
  },
};

// ─── Merchant Overview Read Model ───────────────────────────────────────────

export const merchantOverviewReadModel = {
  async get(merchantId: string): Promise<MerchantOverviewView> {
    const [merchant, paymentCount, totalVolume, payoutCount, refundCount, customerCount] = await Promise.all([
      db.merchant.findUnique({ where: { id: merchantId }, select: { name: true } }),
      db.payment.count({ where: { merchantId } }),
      db.payment.aggregate({ where: { merchantId, status: 'COMPLETED' }, _sum: { amount: true } }),
      db.payout.count({ where: { merchantId } }),
      db.refund.count({ where: { merchantId } }),
      db.customerRecord.count({ where: { merchantId } }),
    ]);
    return {
      merchantId,
      merchantName: merchant?.name ?? 'Unknown',
      paymentCount,
      totalVolume: totalVolume._sum?.amount ?? 0,
      payoutCount,
      refundCount,
      customerCount,
      disputeCount: 0,
    };
  },
};

// ─── Admin Overview Read Model ──────────────────────────────────────────────

export const adminOverviewReadModel = {
  async get(): Promise<AdminOverviewView> {
    const [merchantCount, userCount, paymentCount, volumeAgg, pendingWaitlistCount, recentWaitlist] = await Promise.all([
      db.merchant.count(),
      db.user.count(),
      db.payment.count(),
      db.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      db.waitlistEntry.count({ where: { status: 'PENDING' } }),
      db.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);
    return {
      merchantCount,
      userCount,
      paymentCount,
      totalVolume: volumeAgg._sum?.amount ?? 0,
      pendingWaitlistCount,
      recentWaitlist: recentWaitlist.map(w => ({
        id: w.id, name: w.name, email: w.email,
        company: w.company, country: w.country, status: w.status, createdAt: w.createdAt,
      })),
    };
  },
};

// ─── Audit Log Read Model ───────────────────────────────────────────────────

export const auditLogReadModel = {
  async list(opts?: { take?: number }): Promise<{ logs: AuditLogView[]; total: number }> {
    const [logs, total] = await Promise.all([
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: opts?.take ?? 100 }),
      db.auditLog.count(),
    ]);
    return {
      logs: logs.map(l => ({
        id: l.id, action: l.action, resourceType: l.resourceType,
        resourceId: l.resourceId, result: l.result,
        details: l.details, userId: l.userId, createdAt: l.createdAt,
      })),
      total,
    };
  },
};
