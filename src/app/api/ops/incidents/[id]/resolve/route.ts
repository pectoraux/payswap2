import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/incidents/[id]/resolve — resolve the incident.
 *
 * Body: { rootCause: string, remediation: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Incident ID is required' },
      { status: 400 },
    );
  }
  const parsed = await parseJsonBody<{
    rootCause?: string;
    remediation?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const rootCause =
    typeof parsed.body.rootCause === 'string'
      ? parsed.body.rootCause.trim()
      : '';
  const remediation =
    typeof parsed.body.remediation === 'string'
      ? parsed.body.remediation.trim()
      : '';
  if (!rootCause || !remediation) {
    return NextResponse.json(
      { error: 'rootCause and remediation are required' },
      { status: 400 },
    );
  }

  await opsEngine.incidents.resolve(id, rootCause, remediation);
  await auditOps(
    auth.ctx,
    'OPS.INCIDENT_RESOLVE',
    { incidentId: id, rootCause, remediation },
    id,
  );
  return NextResponse.json({ ok: true });
}
