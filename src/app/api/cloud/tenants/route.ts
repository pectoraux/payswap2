/**
 * GET  /api/cloud/tenants  — list tenants (admin: all; user: own).
 * POST /api/cloud/tenants  — create a new tenant.
 *
 * Query params (GET):
 *   ?type=organization|government|developer_org|enterprise
 *   ?plan=free|starter|growth|scale|enterprise
 *   ?status=active|suspended|terminated
 *   ?q=<name substring>
 *   ?scope=all|mine (default: 'mine' for non-admins, 'all' for admins)
 *
 * Body (POST):
 *   { name: string, slug?: string, type: CloudTenantType, plan: CloudPlan,
 *     region: string, ownerId?: string,
 *     complianceRegion?: CloudComplianceRegion, branding?: {...} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';
import type { CloudTenantType, CloudPlan, CloudComplianceRegion } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: CloudTenantType[] = [
  'organization', 'government', 'developer_org', 'enterprise',
];
const VALID_PLANS: CloudPlan[] = ['free', 'starter', 'growth', 'scale', 'enterprise'];
const VALID_STATUS = ['active', 'suspended', 'terminated'] as const;
const VALID_COMPLIANCE: CloudComplianceRegion[] = ['GH', 'NG', 'KE', 'EU', 'US', 'GLOBAL'];

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? (isAdmin ? 'all' : 'mine');
  const q = url.searchParams.get('q') ?? '';
  const typeParam = url.searchParams.get('type');
  const planParam = url.searchParams.get('plan');
  const statusParam = url.searchParams.get('status');

  const type = typeParam && VALID_TYPES.includes(typeParam as CloudTenantType)
    ? (typeParam as CloudTenantType) : undefined;
  const plan = planParam && VALID_PLANS.includes(planParam as CloudPlan)
    ? (planParam as CloudPlan) : undefined;
  const status = statusParam && (VALID_STATUS as readonly string[]).includes(statusParam)
    ? (statusParam as typeof VALID_STATUS[number]) : undefined;

  let tenants;
  if (scope === 'all' && isAdmin) {
    tenants = tenantManager.list({ type, plan, status, q });
  } else {
    tenants = await tenantManager.listForUser(userId);
    if (type || plan || status || q) {
      tenants = tenantManager.list({ type, plan, status, q })
        .filter((t) => tenants.some((u) => u.id === t.id));
    }
  }

  tenants.sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({
    count: tenants.length,
    overview: cloudEngine.overview(),
    tenants: tenants.map(publicTenant),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const name = (body?.name as string)?.trim();
  const type = body?.type as CloudTenantType;
  const plan = body?.plan as CloudPlan;
  const region = (body?.region as string)?.trim();
  const complianceRegion = body?.complianceRegion as CloudComplianceRegion | undefined;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'name is required (min 2 chars)' }, { status: 400 });
  }
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
  }
  if (!region) {
    return NextResponse.json({ error: 'region is required' }, { status: 400 });
  }
  if (complianceRegion && !VALID_COMPLIANCE.includes(complianceRegion)) {
    return NextResponse.json({ error: 'invalid complianceRegion' }, { status: 400 });
  }

  const ownerId = (body?.ownerId as string)?.trim() || userId;

  const tenant = await tenantManager.create({
    name,
    slug: body?.slug as string | undefined,
    type,
    plan,
    region,
    ownerId,
    complianceRegion,
    branding: body?.branding as { logoUrl?: string; primaryColor?: string; domain?: string } | undefined,
  });

  // Provision the subscription.
  await cloudEngine.billing.createSubscription(tenant.id, plan);

  return NextResponse.json({ tenant: publicTenant(tenant) }, { status: 201 });
}

/** Strip internal-only fields and shape the tenant for the API response. */
function publicTenant(t: ReturnType<typeof tenantManager.list>[number]) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    type: t.type,
    plan: t.plan,
    region: t.region,
    status: t.status,
    ownerId: t.ownerId,
    createdAt: t.createdAt,
    suspendedAt: t.suspendedAt,
    suspendedReason: t.suspendedReason,
    terminatedAt: t.terminatedAt,
    terminatedReason: t.terminatedReason,
    memberCount: t.members.length,
    members: t.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      invitedAt: m.invitedAt,
      joinedAt: m.joinedAt,
      invitedBy: m.invitedBy,
    })),
    config: t.config,
    usage: t.usage,
  };
}
