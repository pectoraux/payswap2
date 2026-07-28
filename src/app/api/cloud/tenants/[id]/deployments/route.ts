/**
 * GET  /api/cloud/tenants/[id]/deployments — list deployments for a tenant.
 * POST /api/cloud/tenants/[id]/deployments — deploy a new environment.
 *
 * POST body: { environment: 'sandbox'|'staging'|'production' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';
import type { CloudDeploymentEnvironment } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ENVS: CloudDeploymentEnvironment[] = ['sandbox', 'staging', 'production'];

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

  const isMember = tenant.members.some((m) => m.userId === userId);
  if (!isAdmin && !isMember) return forbidden();

  const deployments = await cloudEngine.deployments.listForTenant(id);
  return NextResponse.json({ count: deployments.length, deployments });
}

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
  const canManage = isAdmin ||
    (member && (member.role === 'owner' || member.role === 'admin' || member.role === 'operator' || member.role === 'developer'));
  if (!canManage) return forbidden();

  // Plan-based environment gating: free → sandbox only; starter → sandbox/staging; others → all.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const environment = body?.environment as CloudDeploymentEnvironment;
  if (!environment || !VALID_ENVS.includes(environment)) {
    return NextResponse.json({ error: 'invalid environment' }, { status: 400 });
  }
  if (tenant.plan === 'free' && environment !== 'sandbox') {
    return NextResponse.json(
      { error: 'Free plan supports sandbox deployments only' },
      { status: 403 },
    );
  }
  if (tenant.plan === 'starter' && environment === 'production') {
    return NextResponse.json(
      { error: 'Starter plan does not include production deployments — upgrade to Growth or above' },
      { status: 403 },
    );
  }

  const deployment = await cloudEngine.deployments.deploy(id, environment, userId);
  return NextResponse.json({ deployment }, { status: 201 });
}
