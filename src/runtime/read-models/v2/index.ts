/**
 * Read Models v2 — typed façades that pages consume.
 * (M-RT-17/18/19 — frozen contracts; internals swapped to runtime projections.)
 *
 * PRINCIPLE: pages and API routes read through these façades, not directly
 * from Prisma.
 *
 * Migrated capabilities (internals delegate to runtime projections):
 *   - payments  (M-RT-18) — runtime.payments → PaymentProjection
 *   - refunds   (M-RT-19) — runtime.refunds  → RefundProjection
 *
 * Cold-start fallback: if the projection is empty (backfill hasn't run yet),
 * the façade falls back to Prisma so pages never break. Once backfill runs,
 * the projection is authoritative.
 */

import { db } from '@/lib/db';
import { runtime } from '../../index';
import type { PaymentView } from '../../engines/payments';
import type { RefundView } from '../../engines/refunds';

// ─── Types (re-exported from runtime engines — single source of truth) ──────

export type { PaymentView } from '../../engines/payments';
export type { RefundView } from '../../engines/refunds';

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

// ─── Payment Read Model (M-RT-18 — frozen façade, projection-backed) ───────

export const paymentReadModel = {
  async list(merchantId: string, opts?: { take?: number; skip?: number }): Promise<PaymentView[]> {
    const views = await runtime.payments.list(merchantId, opts);
    if (views.length > 0) return views;
    return paymentReadModelLegacy.list(merchantId, opts);
  },

  async count(merchantId: string): Promise<number> {
    const projected = await runtime.payments.count(merchantId);
    if (projected > 0) return projected;
    return paymentReadModelLegacy.count(merchantId);
  },

  async aggregateVolume(merchantId: string): Promise<number> {
    const projected = await runtime.payments.aggregateVolume(merchantId);
    if (projected > 0) return projected;
    return paymentReadModelLegacy.aggregateVolume(merchantId);
  },
};

const paymentReadModelLegacy = {
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
      description: p.description,
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

// ─── Refund Read Model (M-RT-19 — frozen façade, projection-backed) ────────

export const refundReadModel = {
  async list(merchantId: string, env?: string, opts?: { take?: number; skip?: number }): Promise<RefundView[]> {
    const views = await runtime.refunds.list(merchantId, opts);
    if (views.length > 0) return views;
    return refundReadModelLegacy.list(merchantId, env ?? 'live', opts);
  },

  async count(merchantId: string, env?: string): Promise<number> {
    const projected = await runtime.refunds.count(merchantId);
    if (projected > 0) return projected;
    return refundReadModelLegacy.count(merchantId, env ?? 'live');
  },

  async aggregateAmount(merchantId: string): Promise<number> {
    const projected = await runtime.refunds.aggregateAmount(merchantId);
    if (projected > 0) return projected;
    return refundReadModelLegacy.aggregateAmount(merchantId);
  },

  async pendingCount(merchantId: string): Promise<number> {
    return runtime.refunds.pendingCount(merchantId);
  },
};

const refundReadModelLegacy = {
  async list(merchantId: string, env: string, opts?: { take?: number; skip?: number }): Promise<RefundView[]> {
    const refunds = await db.refund.findMany({
      where: { merchantId, environment: env },
      orderBy: { createdAt: 'desc' },
      take: opts?.take ?? 100,
      skip: opts?.skip ?? 0,
    });
    return refunds.map(r => ({
      id: r.id,
      merchantId: r.merchantId,
      paymentId: r.paymentId,
      amount: r.amount,
      type: r.type,
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy,
      approvedBy: r.approvedBy,
      processedAt: r.processedAt,
      createdAt: r.createdAt,
      environment: r.environment,
    }));
  },

  async count(merchantId: string, env: string): Promise<number> {
    return db.refund.count({ where: { merchantId, environment: env } });
  },

  async aggregateAmount(merchantId: string): Promise<number> {
    const agg = await db.refund.aggregate({
      where: { merchantId, status: { in: ['APPROVED', 'PROCESSED'] } },
      _sum: { amount: true },
    });
    return agg._sum?.amount ?? 0;
  },
};

// ─── Customer Read Model (not yet migrated — still Prisma-backed) ──────────

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
