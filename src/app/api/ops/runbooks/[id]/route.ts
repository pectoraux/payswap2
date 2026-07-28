import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/runbooks/[id] — runbook detail with all steps. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Runbook ID is required' },
      { status: 400 },
    );
  }
  const runbook = await opsEngine.runbooks.get(id);
  if (!runbook) {
    return NextResponse.json({ error: 'Runbook not found' }, { status: 404 });
  }
  return NextResponse.json({ runbook });
}
