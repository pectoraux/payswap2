import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/ops/maintenance/[id]/complete — mark a maintenance window as completed. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Maintenance ID is required' },
      { status: 400 },
    );
  }
  await opsEngine.maintenance.complete(id);
  await auditOps(auth.ctx, 'OPS.MAINTENANCE_COMPLETE', { windowId: id }, id);
  return NextResponse.json({ ok: true });
}
