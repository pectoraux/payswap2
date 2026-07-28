import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/incidents/[id] — incident detail with full timeline. */
export async function GET(
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
  const incident = await opsEngine.incidents.get(id);
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }
  return NextResponse.json({ incident });
}
