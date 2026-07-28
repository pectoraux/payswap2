/**
 * POST /api/cloud/deployments/[id]/stop — stop a deployment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id } = await params;
  const deployment = await cloudEngine.deployments.getDeployment(id);
  if (!deployment) {
    return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
  }

  const tenant = await tenantManager.get(deployment.tenantId);
  if (!tenant) return forbidden();

  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin ||
    (member && (member.role === 'owner' || member.role === 'admin' || member.role === 'operator'));
  if (!canManage) return forbidden();

  await cloudEngine.deployments.stop(id, userId);
  return NextResponse.json({ ok: true });
}
