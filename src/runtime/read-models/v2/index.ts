/**
 * Read Models v2 — typed façades that pages consume.
 * (M-RT-17/18/19 — frozen contracts; internals swapped to runtime projections.)
 *
 * Migrated capabilities (internals delegate to runtime projections):
 *   - payments  (M-RT-18) — runtime.payments → PaymentProjection
 *   - refunds   (M-RT-19) — runtime.refunds  → RefundProjection
 *
 * Cold-start fallback: if the projection is empty (backfill hasn't run yet),
 * the façade falls back to Prisma so pages never break.
 */

import { db } from '@/lib/db';
import { runtime } from '../../index';

// ─── Types (what pages receive — never Prisma types) ────────────────────────

// TODO(HARDEN): The three view types below (PaymentView, RefundView, WalletView)
// are duplicated 2-3x across the codebase per the HARDEN-1 audit:
//   - PaymentView: also defined in runtime/engines/payments/types.ts
//   - RefundView:  also defined in runtime/engines/refunds/types.ts
//   - WalletView:  also defined in runtime/engines/wallets/types.ts AND in
//                  components/customer/customer-wallet-actions.tsx
// Consolidate to a single canonical definition in engines/*/types.ts and
// re-export from here. Tracked by HARDEN-1 audit (priority fix #9).

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
  description: string | null;
}

export interface RefundView {
  id: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  processedAt: Date | null;
  createdAt: Date;
  environment: string;
}

export interface WalletView {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  isDefault: boolean;
  isClosed: boolean;
  createdAt: Date;
  lastUpdated: Date;
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

// ─── Payment Read Model (M-RT-18 — frozen façade, projection-backed) ───────

export const paymentReadModel = {
  async list(merchantId: string, opts?: { take?: number; skip?: number }): Promise<PaymentView[]> {
    const views = await runtime.payments.list(merchantId, opts);
    if (views.length > 0) return views;
    // Cold-start fallback to Prisma before backfill has run.
    const payments = await db.payment.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: opts?.take ?? 20, skip: opts?.skip ?? 0 });
    return payments.map(p => ({ id: p.id, reference: p.reference ?? p.id.slice(0, 12), amount: p.amount, currency: p.currency, status: p.status, method: p.method ?? '—', corridor: p.corridor ?? '—', fee: p.fee, netAmount: p.netAmount, createdAt: p.createdAt, settledAt: p.settledAt, customerName: null, customerEmail: null, description: p.description }));
  },
  async count(merchantId: string): Promise<number> {
    const projected = await runtime.payments.count(merchantId);
    if (projected > 0) return projected;
    return db.payment.count({ where: { merchantId } });
  },
  async aggregateVolume(merchantId: string): Promise<number> {
    const projected = await runtime.payments.aggregateVolume(merchantId);
    if (projected > 0) return projected;
    const agg = await db.payment.aggregate({ where: { merchantId, status: 'COMPLETED' }, _sum: { amount: true } });
    return agg._sum?.amount ?? 0;
  },
};

// ─── Refund Read Model (M-RT-19 — frozen façade, projection-backed) ────────

export const refundReadModel = {
  async list(merchantId: string, env?: string, opts?: { take?: number; skip?: number }): Promise<RefundView[]> {
    const views = await runtime.refunds.list(merchantId, opts);
    if (views.length > 0) return views;
    // Cold-start fallback (env filter applied in-memory since Prisma schema may not have environment column).
    const refunds = await db.refund.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: opts?.take ?? 100, skip: opts?.skip ?? 0 });
    return refunds
      .filter(r => !env || (r as unknown as { environment?: string }).environment === env)
      .map(r => ({ id: r.id, merchantId: r.merchantId, paymentId: r.paymentId, amount: r.amount, type: r.type, reason: r.reason, status: r.status, requestedBy: r.requestedBy, approvedBy: r.approvedBy, processedAt: r.processedAt, createdAt: r.createdAt, environment: (r as unknown as { environment?: string }).environment ?? env ?? 'live' }));
  },
  async count(merchantId: string, env?: string): Promise<number> {
    const projected = await runtime.refunds.count(merchantId);
    if (projected > 0) return projected;
    return db.refund.count({ where: { merchantId } });
  },
  async aggregateAmount(merchantId: string): Promise<number> {
    const projected = await runtime.refunds.aggregateAmount(merchantId);
    if (projected > 0) return projected;
    const agg = await db.refund.aggregate({ where: { merchantId, status: { in: ['APPROVED', 'PROCESSED'] } }, _sum: { amount: true } });
    return agg._sum?.amount ?? 0;
  },
  async pendingCount(merchantId: string): Promise<number> {
    return runtime.refunds.pendingCount(merchantId);
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

// ─── Wallet Read Model (M-RT-23 — frozen façade, projection-backed) ────────

export const walletReadModel = {
  async list(opts?: { take?: number; skip?: number; accountId?: string; currency?: string }): Promise<WalletView[]> {
    const views = await runtime.wallets.list(opts);
    if (views.length > 0) return views;
    // Cold-start fallback to Prisma before backfill has run.
    const wallets = await db.wallet.findMany({
      where: { accountId: opts?.accountId, currency: opts?.currency },
      orderBy: { createdAt: 'desc' },
      take: opts?.take ?? 50,
      skip: opts?.skip ?? 0,
    });
    return wallets.map(w => ({
      id: w.id,
      accountId: w.accountId,
      name: w.name,
      currency: w.currency,
      availableBalance: w.balance - w.lockedBalance,
      reservedBalance: w.lockedBalance,
      totalBalance: w.balance,
      isDefault: w.isDefault,
      isClosed: false,
      createdAt: w.createdAt,
      lastUpdated: w.updatedAt,
    }));
  },

  async get(walletId: string): Promise<WalletView | null> {
    const view = await runtime.wallets.get(walletId);
    if (view) return view;
    // Cold-start fallback.
    const w = await db.wallet.findUnique({ where: { id: walletId } });
    if (!w) return null;
    return {
      id: w.id,
      accountId: w.accountId,
      name: w.name,
      currency: w.currency,
      availableBalance: w.balance - w.lockedBalance,
      reservedBalance: w.lockedBalance,
      totalBalance: w.balance,
      isDefault: w.isDefault,
      isClosed: false,
      createdAt: w.createdAt,
      lastUpdated: w.updatedAt,
    };
  },

  async getBalance(walletId: string): Promise<{ available: number; reserved: number; total: number } | null> {
    const balance = await runtime.wallets.getBalance(walletId);
    if (balance) return balance;
    // Cold-start fallback.
    const w = await db.wallet.findUnique({ where: { id: walletId }, select: { balance: true, lockedBalance: true } });
    if (!w) return null;
    return {
      available: w.balance - w.lockedBalance,
      reserved: w.lockedBalance,
      total: w.balance,
    };
  },

  async listByAccount(accountId: string): Promise<WalletView[]> {
    const views = await runtime.wallets.listByAccount(accountId);
    if (views.length > 0) return views;
    // Cold-start fallback.
    const wallets = await db.wallet.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
    return wallets.map(w => ({
      id: w.id,
      accountId: w.accountId,
      name: w.name,
      currency: w.currency,
      availableBalance: w.balance - w.lockedBalance,
      reservedBalance: w.lockedBalance,
      totalBalance: w.balance,
      isDefault: w.isDefault,
      isClosed: false,
      createdAt: w.createdAt,
      lastUpdated: w.updatedAt,
    }));
  },

  async count(): Promise<number> {
    const projected = await runtime.wallets.count();
    if (projected > 0) return projected;
    return db.wallet.count();
  },
};
