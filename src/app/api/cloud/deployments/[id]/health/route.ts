/**
 * GET /api/cloud/deployments/[id]/health — run a health check + recent logs.
 *
 * Returns: { health, status, deployment, logs }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
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

  const isMember = tenant.members.some((m) => m.userId === userId);
  if (!isAdmin && !isMember) return forbidden();

  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100)) : 100;

  const [health, logs] = await Promise.all([
    cloudEngine.deployments.checkHealth(id),
    cloudEngine.deployments.getLogs(id, limit),
  ]);

  return NextResponse.json({
    health,
    status: deployment.status,
    environment: deployment.environment,
    url: deployment.url,
    version: deployment.version,
    region: deployment.region,
    deployedAt: deployment.deployedAt,
    config: deployment.config,
    logs,
  });
}
