import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';
import type { IncidentStatus } from '@/ops/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set<IncidentStatus>([
  'open',
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'postmortem',
]);

/**
 * POST /api/ops/incidents/[id]/update — add a timeline update.
 *
 * Body: { message: string, status?: IncidentStatus }
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
    message?: string;
    status?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const message =
    typeof parsed.body.message === 'string' ? parsed.body.message.trim() : '';
  if (!message) {
    return NextResponse.json(
      { error: 'message is required' },
      { status: 400 },
    );
  }
  let status: IncidentStatus | undefined;
  if (typeof parsed.body.status === 'string') {
    if (!VALID_STATUSES.has(parsed.body.status as IncidentStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    status = parsed.body.status as IncidentStatus;
  }

  await opsEngine.incidents.addUpdate(id, auth.ctx.userId, message, status);
  await auditOps(
    auth.ctx,
    'OPS.INCIDENT_UPDATE',
    { incidentId: id, status, messagePreview: message.slice(0, 80) },
    id,
  );
  return NextResponse.json({ ok: true });
}
