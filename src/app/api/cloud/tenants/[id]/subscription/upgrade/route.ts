/**
 * POST /api/cloud/tenants/[id]/subscription/upgrade — upgrade (or downgrade) plan.
 *
 * Body: { plan: CloudPlan }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';
import type { CloudPlan } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLANS: CloudPlan[] = ['free', 'starter', 'growth', 'scale', 'enterprise'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin || (member && (member.role === 'owner' || member.role === 'admin'));
  if (!canManage) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const plan = body?.plan as CloudPlan;
  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
  }

  await cloudEngine.billing.upgrade(id, plan, userId);

  // Sync the tenant's plan + limits + features with the new plan.
  const { getPlanDefinition } = await import('@/cloud');
  const planDef = getPlanDefinition(plan);
  await tenantManager.update(id, {
    config: {
      ...tenant.config,
      features: planDef.features,
      limits: planDef.limits,
    },
  }, userId);
  // Also update the denormalized plan on the tenant record.
  const updated = await tenantManager.get(id);
  if (updated) {
    updated.plan = plan;
  }

  const subscription = await cloudEngine.billing.getSubscription(id);
  return NextResponse.json({ ok: true, plan, subscription });
}
