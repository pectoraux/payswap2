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
    | 'lp'
    | 'developer'
    | 'system';
  createdAt: string;
}

const CATEGORY_KEYWORDS: Array<{
  category: NotificationItem['category'];
  pattern: RegExp;
}> = [
  { category: 'compliance', pattern: /aml|sanction|kyc|compliance|case/i },
  { category: 'treasury', pattern: /treasury|reserve|corridor|rebalance/i },
  { category: 'payout', pattern: /payout|disburs|withdraw/i },
  { category: 'refund', pattern: /refund/i },
  { category: 'payment', pattern: /payment|charge|invoice/i },
  { category: 'team', pattern: /team|invite|member/i },
  { category: 'webhook', pattern: /webhook|delivery/i },
  { category: 'lp', pattern: /\blp\b|liquidity.provider|corridor/i },
  { category: 'developer', pattern: /api.?key|extension|sandbox|developer/i },
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
 * Pure helper — given a single notification (action + resourceType) and a
 * user's id + roles, decide whether the notification is relevant to them.
 *
 * Rules (top-down — first match wins):
 *   1. SUPER_ADMIN / ADMIN          → everything
 *   2. userId === currentUserId     → your own action, always relevant
 *   3. COMPLIANCE                   → AML / KYC / sanctions / compliance
 *   4. TREASURY                     → treasury / reserve / corridor / freeze
 *   5. OPERATIONS / OPS             → incident / outage / ops
 *   6. SUPPORT                      → support / ticket
 *   7. MERCHANT / MERCHANT_STAFF    → payment / payout / refund / invoice
 *                                     / webhook / api-key / team
 *   8. LP                           → LP / corridor / capital / liquidity
 *   9. DEVELOPER                    → api-key / webhook / extension / sandbox
 *  10. CUSTOMER                     → payment / invoice / wallet / deposit
 *  11. otherwise                    → only your own actions (rule 2)
 *
 * The same logic is mirrored in `buildWhereClause` so the DB query can prune
 * rows server-side rather than pulling everything and filtering in JS.
 */
export function matchesUser(
  notification: { action: string; resourceType: string; userId?: string | null },
  currentUserId: string,
  roles: string[],
): boolean {
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) return true;
  if (notification.userId && notification.userId === currentUserId) return true;

  const hay = `${notification.action} ${notification.resourceType}`.toLowerCase();

  if (roles.includes('COMPLIANCE')) {
    if (/aml|sanction|kyc|compliance|case/.test(hay)) return true;
  }
  if (roles.includes('TREASURY')) {
    if (/treasury|reserve|corridor|freeze|rebalance/.test(hay)) return true;
  }
  if (roles.includes('OPERATIONS') || roles.includes('OPS')) {
    if (/incident|outage|ops/.test(hay)) return true;
  }
  if (roles.includes('SUPPORT')) {
    if (/support|ticket/.test(hay)) return true;
  }
  if (roles.includes('MERCHANT') || roles.includes('MERCHANT_STAFF')) {
    if (/payment|payout|refund|invoice|webhook|api.?key|team|customer|dispute/.test(hay))
      return true;
  }
  if (roles.includes('LP')) {
    if (/\blp\b|corridor|capital|liquidity/.test(hay)) return true;
  }
  if (roles.includes('DEVELOPER')) {
    if (/api.?key|webhook|extension|sandbox|developer/.test(hay)) return true;
  }
  if (roles.includes('CUSTOMER')) {
    if (/payment|invoice|wallet|deposit|transfer/.test(hay)) return true;
  }

  return false;
}

/**
 * Build a Prisma `where` clause that returns only the audit-log rows
 * relevant to the current user. Mirrors the `matchesUser` rules above but
 * pushed down into the DB so we don't pull 10k rows to render 10.
 */
function buildWhereClause(
  userId: string,
  roles: string[],
): Prisma.AuditLogWhereInput {
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) {
    return {};
  }

  const orClauses: Prisma.AuditLogWhereInput[] = [
    { userId }, // always see your own actions
  ];

  const pushOr = (
    sub: Prisma.AuditLogWhereInput[],
  ) => orClauses.push({ OR: sub });

  if (roles.includes('COMPLIANCE')) {
    pushOr([
      { action: { contains: 'compliance' } },
      { action: { contains: 'aml' } },
      { action: { contains: 'sanction' } },
      { action: { contains: 'kyc' } },
      { resourceType: { contains: 'COMPLIANCE' } },
      { resourceType: { contains: 'SANCTION' } },
      { resourceType: { contains: 'AML' } },
      { resourceType: { contains: 'KYC' } },
    ]);
  }

  if (roles.includes('TREASURY')) {
    pushOr([
      { action: { contains: 'treasury' } },
      { action: { contains: 'reserve' } },
      { action: { contains: 'corridor' } },
      { action: { contains: 'freeze' } },
      { action: { contains: 'rebalance' } },
      { resourceType: { contains: 'TREASURY' } },
      { resourceType: { contains: 'RESERVE' } },
      { resourceType: { contains: 'CORRIDOR' } },
    ]);
  }

  if (roles.includes('OPERATIONS') || roles.includes('OPS')) {
    pushOr([
      { action: { contains: 'incident' } },
      { action: { contains: 'outage' } },
      { action: { contains: 'ops' } },
      { resourceType: { contains: 'INCIDENT' } },
      { resourceType: { contains: 'OPS' } },
    ]);
  }

  if (roles.includes('SUPPORT')) {
    pushOr([
      { action: { contains: 'support' } },
      { action: { contains: 'ticket' } },
      { resourceType: { contains: 'SUPPORT' } },
      { resourceType: { contains: 'TICKET' } },
    ]);
  }

  if (roles.includes('MERCHANT') || roles.includes('MERCHANT_STAFF')) {
    pushOr([
      { action: { contains: 'payment' } },
      { action: { contains: 'payout' } },
      { action: { contains: 'refund' } },
      { action: { contains: 'invoice' } },
      { action: { contains: 'webhook' } },
      { action: { contains: 'api_key' } },
      { action: { contains: 'api-key' } },
      { action: { contains: 'team' } },
      { action: { contains: 'customer' } },
      { action: { contains: 'dispute' } },
      { resourceType: { contains: 'PAYMENT' } },
      { resourceType: { contains: 'PAYOUT' } },
      { resourceType: { contains: 'REFUND' } },
      { resourceType: { contains: 'INVOICE' } },
      { resourceType: { contains: 'WEBHOOK' } },
      { resourceType: { contains: 'API_KEY' } },
      { resourceType: { contains: 'TEAM' } },
      { resourceType: { contains: 'CUSTOMER' } },
      { resourceType: { contains: 'DISPUTE' } },
    ]);
  }

  if (roles.includes('LP')) {
    pushOr([
      { action: { contains: 'lp' } },
      { action: { contains: 'corridor' } },
      { action: { contains: 'capital' } },
      { action: { contains: 'liquidity' } },
      { resourceType: { contains: 'LP' } },
      { resourceType: { contains: 'CORRIDOR' } },
      { resourceType: { contains: 'CAPITAL' } },
      { resourceType: { contains: 'LIQUIDITY' } },
    ]);
  }

  if (roles.includes('DEVELOPER')) {
    pushOr([
      { action: { contains: 'api_key' } },
      { action: { contains: 'api-key' } },
      { action: { contains: 'webhook' } },
      { action: { contains: 'extension' } },
      { action: { contains: 'sandbox' } },
      { action: { contains: 'developer' } },
      { resourceType: { contains: 'API_KEY' } },
      { resourceType: { contains: 'WEBHOOK' } },
      { resourceType: { contains: 'EXTENSION' } },
      { resourceType: { contains: 'SANDBOX' } },
      { resourceType: { contains: 'DEVELOPER' } },
    ]);
  }

  if (roles.includes('CUSTOMER')) {
    pushOr([
      { action: { contains: 'payment' } },
      { action: { contains: 'invoice' } },
      { action: { contains: 'wallet' } },
      { action: { contains: 'deposit' } },
      { action: { contains: 'transfer' } },
      { resourceType: { contains: 'PAYMENT' } },
      { resourceType: { contains: 'INVOICE' } },
      { resourceType: { contains: 'WALLET' } },
      { resourceType: { contains: 'DEPOSIT' } },
      { resourceType: { contains: 'TRANSFER' } },
    ]);
  }

  return { OR: orClauses };
}

/**
 * GET /api/notifications
 *
 * Returns the most recent audit-log entries that are RELEVANT to the
 * current user — see `buildWhereClause` for the exact scoping rules.
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
