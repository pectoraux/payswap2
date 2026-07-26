import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireMerchantId, requireSession, unauthorized } from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ActivityType =
  | 'payment'
  | 'payout'
  | 'refund'
  | 'webhook'
  | 'audit';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  amount: number | null;
  currency: string | null;
  amountFormatted: string | null;
  status: string;
  createdAt: string;
  merchantName: string | null;
  /** Optional reference (e.g. payment reference) for display + deep links. */
  reference?: string | null;
}

interface ActivityResponse {
  items: ActivityItem[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  filter: ActivityType | 'all';
}

const VALID_FILTERS: ReadonlySet<string> = new Set([
  'all',
  'payment',
  'payout',
  'refund',
  'webhook',
  'audit',
]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function clampOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normaliseFilter(value: unknown): ActivityType | 'all' {
  if (typeof value === 'string' && VALID_FILTERS.has(value)) {
    return value as ActivityType | 'all';
  }
  return 'all';
}

function fmtMoney(amount: number | null, currency: string | null): string | null {
  if (amount === null || amount === undefined) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ''}`.trim();
  }
}

/**
 * GET /api/activity
 *
 * Returns a unified, merchant-scoped activity feed merging payments, payouts,
 * refunds, webhook deliveries, and audit logs. The result is sorted by
 * `createdAt` descending and supports pagination + filtering by type.
 *
 * Query params:
 *   - limit  (default 25, max 100)
 *   - offset (default 0)
 *   - type   (all | payment | payout | refund | webhook | audit)
 *
 * If the caller is a merchant / merchant staff member, the feed is scoped to
 * their merchant. If the caller is an admin (no merchant), the feed returns
 * global activity so the same endpoint powers both views.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  const url = new URL(req.url);
  const filter = normaliseFilter(url.searchParams.get('type'));
  const limit = clampLimit(url.searchParams.get('limit'));
  const offset = clampOffset(url.searchParams.get('offset'));
  const env = await getEnvironment();

  // Each source query fetches one page beyond what we need (limit + 1) so we
  // can compute `hasMore` without a second COUNT(*) round trip on every call.
  const fetchSize = limit + 1;
  const items: ActivityItem[] = [];

  // Helper that catches per-source failures — a single broken source should
  // not blank the whole feed.
  const runSafe = async <T>(p: Promise<T[]>): Promise<T[]> => {
    try {
      return await p;
    } catch (err) {
      console.error('[activity] query failed:', err);
      return [] as T[];
    }
  };

  // ───────── Payments ─────────
  if (filter === 'all' || filter === 'payment') {
    const rows = await runSafe(
      db.payment.findMany({
        where: merchantId ? { merchantId, environment: env } : { environment: env },
        orderBy: { createdAt: 'desc' },
        take: fetchSize,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          description: true,
          reference: true,
          method: true,
          createdAt: true,
          merchant: { select: { name: true } },
        },
      }),
    );
    for (const r of rows) {
      items.push({
        id: `payment:${r.id}`,
        type: 'payment',
        description:
          r.description?.trim() ||
          `Payment via ${r.method || 'unknown method'}`,
        amount: r.amount,
        currency: r.currency,
        amountFormatted: fmtMoney(r.amount, r.currency),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        merchantName: r.merchant?.name ?? null,
        reference: r.reference,
      });
    }
  }

  // ───────── Payouts ─────────
  if (filter === 'all' || filter === 'payout') {
    const rows = await runSafe(
      db.payout.findMany({
        where: merchantId ? { merchantId, environment: env } : { environment: env },
        orderBy: { createdAt: 'desc' },
        take: fetchSize,
        select: {
          id: true,
          sourceAmount: true,
          sourceCurrency: true,
          destinationCurrency: true,
          status: true,
          reason: true,
          method: true,
          createdAt: true,
          merchant: { select: { name: true } },
        },
      }),
    );
    for (const r of rows) {
      items.push({
        id: `payout:${r.id}`,
        type: 'payout',
        description:
          r.reason?.trim() ||
          `Payout via ${r.method || 'unknown method'} → ${r.destinationCurrency}`,
        amount: r.sourceAmount,
        currency: r.sourceCurrency,
        amountFormatted: fmtMoney(r.sourceAmount, r.sourceCurrency),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        merchantName: r.merchant?.name ?? null,
      });
    }
  }

  // ───────── Refunds ─────────
  if (filter === 'all' || filter === 'refund') {
    const rows = await runSafe(
      db.refund.findMany({
        where: merchantId ? { merchantId, environment: env } : { environment: env },
        orderBy: { createdAt: 'desc' },
        take: fetchSize,
        select: {
          id: true,
          amount: true,
          status: true,
          reason: true,
          type: true,
          createdAt: true,
          merchant: { select: { name: true } },
        },
      }),
    );
    for (const r of rows) {
      const typeLabel = r.type
        ? r.type.charAt(0) + r.type.slice(1).toLowerCase()
        : '';
      items.push({
        id: `refund:${r.id}`,
        type: 'refund',
        description: r.reason?.trim() || `${typeLabel} refund`.trim(),
        amount: r.amount,
        currency: null,
        amountFormatted: null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        merchantName: r.merchant?.name ?? null,
      });
    }
  }

  // ───────── Webhook deliveries ─────────
  if (filter === 'all' || filter === 'webhook') {
    const rows = await runSafe(
      db.webhookDelivery.findMany({
        // WebhookDelivery has no direct merchantId/environment; scope via the
        // endpoint relation. Admins (no merchantId) see all deliveries for the
        // current environment.
        where: merchantId
          ? { endpoint: { merchantId, environment: env } }
          : { endpoint: { environment: env } },
        orderBy: { createdAt: 'desc' },
        take: fetchSize,
        select: {
          id: true,
          eventType: true,
          status: true,
          responseStatus: true,
          attempts: true,
          createdAt: true,
          endpoint: {
            select: {
              url: true,
              merchant: { select: { name: true } },
            },
          },
        },
      }),
    );
    for (const r of rows) {
      const endpointHost = (() => {
        try {
          return r.endpoint?.url ? new URL(r.endpoint.url).host : null;
        } catch {
          return r.endpoint?.url ?? null;
        }
      })();
      items.push({
        id: `webhook:${r.id}`,
        type: 'webhook',
        description: `${r.eventType} → ${endpointHost ?? 'endpoint'}`,
        amount: null,
        currency: null,
        amountFormatted: null,
        status: r.responseStatus != null ? `HTTP ${r.responseStatus}` : r.status,
        createdAt: r.createdAt.toISOString(),
        merchantName: r.endpoint?.merchant?.name ?? null,
      });
    }
  }

  // ───────── Audit logs ─────────
  if (filter === 'all' || filter === 'audit') {
    const rows = await runSafe(
      db.auditLog.findMany({
        // AuditLog has no merchant FK and no `environment` column, so it cannot
        // be scoped by environment. Scope to the user's own actions when the
        // caller is a merchant, so the feed stays relevant. Admins see
        // everything.
        where: merchantId ? { userId: (session.user as any)?.id } : undefined,
        orderBy: { createdAt: 'desc' },
        take: fetchSize,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          details: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    );
    for (const r of rows) {
      items.push({
        id: `audit:${r.id}`,
        type: 'audit',
        description: `${r.action} on ${r.resourceType}`,
        amount: null,
        currency: null,
        amountFormatted: null,
        status: r.result,
        createdAt: r.createdAt.toISOString(),
        merchantName: r.user?.name ?? r.user?.email ?? 'System',
      });
    }
  }

  // Merge + sort + paginate.
  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = items.length;
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  const body: ActivityResponse = {
    items: page,
    total,
    hasMore,
    limit,
    offset,
    filter,
  };

  return NextResponse.json(body, {
    headers: {
      // Always fresh — this is a live feed.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
