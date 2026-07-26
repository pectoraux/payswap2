import { NextResponse } from 'next/server';
import { requireSession, requireMerchantId, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface NotificationItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  description: string;
  /** Category used to pick the icon + tone on the client. */
  category: 'payment' | 'payout' | 'refund' | 'team' | 'compliance' | 'treasury' | 'webhook' | 'incident' | 'system';
  createdAt: string;
}

const CATEGORY_KEYWORDS: Array<{ category: NotificationItem['category']; pattern: RegExp }> = [
  { category: 'payment', pattern: /payment|charge|invoice/i },
  { category: 'payout', pattern: /payout|disburs|withdraw/i },
  { category: 'refund', pattern: /refund/i },
  { category: 'team', pattern: /team|invite|member/i },
  { category: 'compliance', pattern: /aml|sanction|kyc|compliance|case/i },
  { category: 'treasury', pattern: /treasury|reserve|corridor|rebalance/i },
  { category: 'webhook', pattern: /webhook|delivery/i },
  { category: 'incident', pattern: /incident/i },
];

function categorize(action: string, resourceType: string): NotificationItem['category'] {
  const hay = `${action} ${resourceType}`;
  for (const k of CATEGORY_KEYWORDS) {
    if (k.pattern.test(hay)) return k.category;
  }
  return 'system';
}

function describe(action: string, resourceType: string): string {
  const verb = action.split(/[._]/)[0]?.toLowerCase() ?? action.toLowerCase();
  const cap = verb.charAt(0).toUpperCase() + verb.slice(1);
  return `${cap} · ${resourceType}`;
}

/**
 * GET /api/notifications
 *
 * Returns the most recent audit log entries for the current user (or, for
 * admins with no merchant scope, the platform-wide last 10 entries).
 *
 * Each entry is mapped to a UI-friendly `NotificationItem` with a category
 * and a one-line description. The client component uses the `createdAt`
 * timestamp + a localStorage "last viewed" marker to compute the unread
 * badge count — there's no server-side read tracking.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  const userId = (session.user as any)?.id as string | undefined;

  // For merchants, scope to their own actions (matching the activity feed).
  // For admins / super admins, return platform-wide entries.
  const where = merchantId ? { userId } : undefined;

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      result: true,
      createdAt: true,
    },
  });

  const items: NotificationItem[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    result: r.result,
    description: describe(r.action, r.resourceType),
    category: categorize(r.action, r.resourceType),
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json(
    { items },
    {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
