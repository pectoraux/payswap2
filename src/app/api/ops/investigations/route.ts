import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/investigations — list investigations.
 *
 * Query params:
 *   - status: 'open' | 'in_progress' | 'concluded'
 *   - assignedTo: userId
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const assignedTo = url.searchParams.get('assignedTo') ?? undefined;
  const investigations = await opsEngine.investigations.list({
    status,
    assignedTo,
  });
  return NextResponse.json({ investigations });
}

/**
 * POST /api/ops/investigations — open a new investigation.
 *
 * Body: { title, description, assignedTo, incidentId?, findings? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    title?: string;
    description?: string;
    assignedTo?: string;
    incidentId?: string;
    findings?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const assignedTo =
    typeof body.assignedTo === 'string' && body.assignedTo.trim()
      ? body.assignedTo.trim()
      : auth.ctx.userId;
  const incidentId =
    typeof body.incidentId === 'string' && body.incidentId.trim()
      ? body.incidentId.trim()
      : undefined;
  const findings =
    typeof body.findings === 'string' ? body.findings.trim() : '';

  const investigation = await opsEngine.investigations.create({
    title,
    description,
    assignedTo,
    incidentId,
    findings,
  });
  await auditOps(
    auth.ctx,
    'OPS.INVESTIGATION_OPEN',
    { investigationId: investigation.id, title, incidentId },
    investigation.id,
  );
  return NextResponse.json({ investigation }, { status: 201 });
}
