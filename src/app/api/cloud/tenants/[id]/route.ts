/**
 * GET   /api/cloud/tenants/[id] — tenant detail (admin or member).
 * PATCH /api/cloud/tenants/[id] — update tenant (admin or owner).
 *
 * PATCH body:
 *   { name?: string, region?: string, config?: Partial<CloudTenantConfig> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
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

  // Authorize: admin or tenant member.
  const isMember = tenant.members.some((m) => m.userId === userId);
  if (!isAdmin && !isMember) return forbidden();

  // Hydrate related entities for the detail view.
  const [programs, deployments, subscription, audit] = await Promise.all([
    cloudEngine.programs.listForTenant(id),
    cloudEngine.deployments.listForTenant(id),
    cloudEngine.billing.getSubscription(id),
    cloudEngine.audit.query(id),
  ]);

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      plan: tenant.plan,
      region: tenant.region,
      status: tenant.status,
      ownerId: tenant.ownerId,
      createdAt: tenant.createdAt,
      suspendedAt: tenant.suspendedAt,
      suspendedReason: tenant.suspendedReason,
      terminatedAt: tenant.terminatedAt,
      terminatedReason: tenant.terminatedReason,
      members: tenant.members,
      config: tenant.config,
      usage: tenant.usage,
    },
    programs,
    deployments,
    subscription,
    audit: audit.slice(0, 50),
  });
}

export async function PATCH(
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

  // Authorize: admin or tenant owner/admin.
  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin || (member && (member.role === 'owner' || member.role === 'admin'));
  if (!canManage) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const updates: {
    name?: string;
    region?: string;
    config?: Partial<typeof tenant.config>;
  } = {};

  if (typeof body?.name === 'string' && body.name.trim().length >= 2) {
    updates.name = body.name.trim();
  }
  if (typeof body?.region === 'string' && body.region.trim()) {
    updates.region = body.region.trim();
  }
  if (body?.config && typeof body.config === 'object') {
    updates.config = body.config as Partial<typeof tenant.config>;
  }

  await tenantManager.update(id, updates, userId);
  const updated = await tenantManager.get(id);
  return NextResponse.json({ tenant: updated });
}
