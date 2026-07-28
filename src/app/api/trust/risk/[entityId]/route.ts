import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { riskEngine, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/risk/[entityId]
 *
 * Get the current risk score for an entity. Returns null if the entity
 * has no recorded state.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { entityId } = await params;
  const score = await riskEngine.getScore(entityId);
  return NextResponse.json({ score });
}
