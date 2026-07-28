import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/incidents/[id]/assign — assign the incident to a user.
 *
 * Body: { assigneeId?: string }  (defaults to the caller)
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
  const parsed = await parseJsonBody<{ assigneeId?: string }>(req);
  if (!parsed.ok) return parsed.response;

  const assigneeId =
    typeof parsed.body.assigneeId === 'string' && parsed.body.assigneeId.trim()
      ? parsed.body.assigneeId.trim()
      : auth.ctx.userId;

  await opsEngine.incidents.assign(id, assigneeId);
  await auditOps(
    auth.ctx,
    'OPS.INCIDENT_ASSIGN',
    { incidentId: id, assigneeId },
    id,
  );
  return NextResponse.json({ ok: true, assigneeId });
}
