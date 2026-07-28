import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/migrations/[id]/rollback — roll back a migration.
 *
 * Body: { reason: string }
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
      { error: 'Migration ID is required' },
      { status: 400 },
    );
  }
  const parsed = await parseJsonBody<{ reason?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const reason =
    typeof parsed.body.reason === 'string' ? parsed.body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { error: 'reason is required' },
      { status: 400 },
    );
  }
  await opsEngine.migrations.rollback(id, reason);
  await auditOps(
    auth.ctx,
    'OPS.MIGRATION_ROLLBACK',
    { migrationId: id, reason, rolledBackBy: auth.ctx.userId },
    id,
  );
  return NextResponse.json({ ok: true });
}
