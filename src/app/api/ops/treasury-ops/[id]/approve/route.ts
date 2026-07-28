import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/ops/treasury-ops/[id]/approve — approve a pending treasury operation. */
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
  try {
    await opsEngine.treasury.approve(id, auth.ctx.userId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Approval failed' },
      { status: 400 },
    );
  }
  await auditOps(
    auth.ctx,
    'OPS.TREASURY_OP_APPROVE',
    { opId: id, approvedBy: auth.ctx.userId },
    id,
  );
  return NextResponse.json({ ok: true });
}
