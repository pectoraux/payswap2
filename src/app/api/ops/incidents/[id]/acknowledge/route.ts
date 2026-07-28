import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/ops/incidents/[id]/acknowledge — acknowledge the incident. */
export async function POST(
  _req: NextRequest,
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
  await opsEngine.incidents.acknowledge(id, auth.ctx.userId);
  await auditOps(
    auth.ctx,
    'OPS.INCIDENT_ACK',
    { incidentId: id, acknowledgedBy: auth.ctx.userId },
    id,
  );
  return NextResponse.json({ ok: true });
}
