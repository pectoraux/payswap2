import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { riskEngine, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/trust/risk/[entityId]/recompute
 *
 * Force a risk score recompute for an entity. Body (optional):
 *   { entityType?: 'user' | 'merchant' | 'lp' | 'transaction' | 'wallet' }
 */
export async function POST(
  req: NextRequest,
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
  const userId = (session.user as any)?.id as string | undefined;

  const { entityId } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const entityType =
    typeof body?.entityType === 'string' ? body.entityType : undefined;

  const score = await riskEngine.forceRecompute(entityId, entityType as any);

  await complianceAuditTrail.record({
    action: 'trust.risk.recompute',
    actorId: userId ?? 'unknown',
    entityType: entityType ?? 'unknown',
    entityId,
    details: {
      score: score.score,
      level: score.level,
      factorCount: score.factors.length,
      factors: score.factors.map((f) => ({ name: f.name, weight: f.weight })),
    },
    result: 'success',
  });

  return NextResponse.json({ score });
}
