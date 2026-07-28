import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/ops/migrations/[id]/start — start a planned migration. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Migration ID is required' },
      { status: 400 },
    );
  }
  await opsEngine.migrations.start(id, auth.ctx.userId);
  await auditOps(
    auth.ctx,
    'OPS.MIGRATION_START',
    { migrationId: id, startedBy: auth.ctx.userId },
    id,
  );
  return NextResponse.json({ ok: true });
}
