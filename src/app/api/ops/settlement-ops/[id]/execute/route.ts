import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/ops/settlement-ops/[id]/execute — execute an approved settlement operation. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Operation ID is required' },
      { status: 400 },
    );
  }
  await opsEngine.settlement.execute(id);
  await auditOps(
    auth.ctx,
    'OPS.SETTLEMENT_OP_EXECUTE',
    { opId: id, executedBy: auth.ctx.userId },
    id,
  );
  return NextResponse.json({ ok: true });
}
