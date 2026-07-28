import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

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
  category:
    | 'payment'
    | 'payout'
    | 'refund'
    | 'team'
    | 'compliance'
    | 'treasury'
    | 'webhook'
    | 'incident'
    | 'system';
  createdAt: string;
}

const CATEGORY_KEYWORDS: Array<{
  category: NotificationItem['category'];
  pattern: RegExp;
}> = [
  { category: 'payment', pattern: /payment|charge|invoice/i },
  { category: 'payout', pattern: /payout|disburs|withdraw/i },
  { category: 'refund', pattern: /refund/i },
  { category: 'team', pattern: /team|invite|member/i },
  { category: 'compliance', pattern: /aml|sanction|kyc|compliance|case/i },
  { category: 'treasury', pattern: /treasury|reserve|corridor|rebalance/i },
  { category: 'webhook', pattern: /webhook|delivery/i },
  { category: 'incident', pattern: /incident|outage/i },
];

function categorize(
  action: string,
  resourceType: string,
): NotificationItem['category'] {
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
 * Build a Prisma `where` clause that returns only the audit-log rows
 * relevant to the current user.
 *
 * Rules:
 *   - SUPER_ADMIN / ADMIN: see everything (platform-wide audit).
 *   - Everyone else: always see their own actions (userId = me) AND see
 *     role-scoped entries based on their role:
 *       • MERCHANT / MERCHANT_STAFF → also see Payment/Payout/Refund/Invoice
 *         entries that touch their merchant (we approximate this with a
 *         substring match on the merchantId stored in `details` JSON — but
 *         since the audit log doesn't reliably carry the merchantId on every
 *         row, we fall back to userId-only scoping for merchants).
 *       • COMPLIANCE → also see compliance / AML / sanction / KYC entries.
 *       • TREASURY → also see treasury / reserve / corridor / freeze entries.
 *       • OPERATIONS → also see incident / ops entries.
 *       • SUPPORT → also see support-related entries.
 *       • LP → own actions only.
 *       • DEVELOPER → own actions only.
 *       • CUSTOMER → own actions only.
 *
 * This stops the previous behaviour of "non-merchant = see the entire
 * platform's audit log" which surfaced irrelevant rows to treasury / ops /
 * compliance users.
 */
function buildWhereClause(
  userId: string,
  roles: string[],
): Prisma.AuditLogWhereInput {
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) {
    // Admins see the full audit log.
    return {};
  }

  const orClauses: Prisma.AuditLogWhereInput[] = [
    { userId }, // always see your own actions
  ];

  if (roles.includes('COMPLIANCE')) {
    orClauses.push({
      OR: [
        { action: { contains: 'compliance' } },
        { action: { contains: 'aml' } },
        { action: { contains: 'sanction' } },
        { action: { contains: 'kyc' } },
        { resourceType: { contains: 'COMPLIANCE' } },
        { resourceType: { contains: 'SANCTION' } },
        { resourceType: { contains: 'AML' } },
        { resourceType: { contains: 'KYC' } },
      ],
    });
  }

  if (roles.includes('TREASURY')) {
    orClauses.push({
      OR: [
        { action: { contains: 'treasury' } },
        { action: { contains: 'reserve' } },
        { action: { contains: 'corridor' } },
        { action: { contains: 'freeze' } },
        { action: { contains: 'rebalance' } },
        { resourceType: { contains: 'TREASURY' } },
        { resourceType: { contains: 'RESERVE' } },
        { resourceType: { contains: 'CORRIDOR' } },
      ],
    });
  }

  if (roles.includes('OPERATIONS') || roles.includes('OPS')) {
    orClauses.push({
      OR: [
        { action: { contains: 'incident' } },
        { action: { contains: 'outage' } },
        { action: { contains: 'ops' } },
        { resourceType: { contains: 'INCIDENT' } },
        { resourceType: { contains: 'OPS' } },
      ],
    });
  }

  if (roles.includes('SUPPORT')) {
    orClauses.push({
      OR: [
        { action: { contains: 'support' } },
        { action: { contains: 'ticket' } },
        { resourceType: { contains: 'SUPPORT' } },
        { resourceType: { contains: 'TICKET' } },
      ],
    });
  }

  return { OR: orClauses };
}

/**
 * GET /api/notifications
 *
 * Returns the most recent audit-log entries that are RELEVANT to the
 * current user — see `buildWhereClause` for the exact scoping rules.
 *
 * Each entry is mapped to a UI-friendly `NotificationItem` with a category
 * and a one-line description. The client component uses the `createdAt`
 * timestamp + a localStorage "last viewed" marker to compute the unread
 * badge count — there's no server-side read tracking.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];

  const where = buildWhereClause(userId, roles);

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
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
