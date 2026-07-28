import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/audit
 *
 * Query the compliance audit trail. Supports filters:
 *   ?action=<substring>
 *   ?actorId=<id>
 *   ?entityType=<type>
 *   ?entityId=<id>
 *   ?result=success|denied|error
 *   ?fromTs=<epoch ms>
 *   ?toTs=<epoch ms>
 *   ?limit=<int>   (default 100, max 500)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const sp = url.searchParams;
  const limitParam = sp.get('limit');
  const limit = limitParam
    ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 100))
    : 100;

  const entries = await complianceAuditTrail.query({
    action: sp.get('action') ?? undefined,
    actorId: sp.get('actorId') ?? undefined,
    entityType: sp.get('entityType') ?? undefined,
    entityId: sp.get('entityId') ?? undefined,
    result: (sp.get('result') as any) ?? undefined,
    from: sp.get('fromTs') ? parseInt(sp.get('fromTs')!, 10) : undefined,
    to: sp.get('toTs') ? parseInt(sp.get('toTs')!, 10) : undefined,
    limit,
  });
  const stats = complianceAuditTrail.stats();

  return NextResponse.json({ entries, stats });
}
