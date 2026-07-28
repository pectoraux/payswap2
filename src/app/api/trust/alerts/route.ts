import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { amlPipeline } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/alerts
 *
 * List AML alerts. Optional filters:
 *   ?status=open          open|investigating|escalated|closed|sar_filed
 *   ?severity=high        low|medium|high|critical
 *   ?entityId=<id>        filter by entity
 *   ?ruleId=<id>          filter by rule
 *
 * Returns `{ alerts, rules }` — the rules list lets the UI render
 * human-readable rule metadata alongside each alert.
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
  const status = url.searchParams.get('status') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;
  const entityId = url.searchParams.get('entityId') ?? undefined;
  const ruleId = url.searchParams.get('ruleId') ?? undefined;

  const alerts = await amlPipeline.listAlerts({
    status: (status as any) ?? undefined,
    severity: (severity as any) ?? undefined,
    entityId: entityId ?? undefined,
  });
  const rules = amlPipeline.listRules().map(({ evaluate: _e, explain: _x, ...rest }) => rest);

  return NextResponse.json({ alerts, rules });
}
