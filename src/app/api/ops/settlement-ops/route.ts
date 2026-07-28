import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set([
  'manual_settlement',
  'retry_failed',
  'force_complete',
  'reverse',
  'reconcile',
]);

/**
 * GET /api/ops/settlement-ops — list settlement operations.
 *
 * Query params:
 *   - status: pending | approved | executed | failed
 *   - type: manual_settlement | retry_failed | force_complete | reverse | reconcile
 *   - failed: '1' — return only failed settlements
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  if (url.searchParams.get('failed') === '1') {
    const failed = await opsEngine.settlement.getFailedSettlements();
    return NextResponse.json({ operations: failed });
  }
  const status = url.searchParams.get('status') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  if (type && !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  const operations = await opsEngine.settlement.list({ status, type });
  return NextResponse.json({ operations });
}

/**
 * POST /api/ops/settlement-ops — request a new settlement operation.
 *
 * Body: { type, transactionId, rationale }
 *
 * Special case: type=retry_failed with transactionId='*' creates a bulk
 * retry operation.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    type?: string;
    transactionId?: string;
    rationale?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const type =
    typeof body.type === 'string' && VALID_TYPES.has(body.type)
      ? (body.type as 'manual_settlement' | 'retry_failed' | 'force_complete' | 'reverse' | 'reconcile')
      : null;
  if (!type) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  const transactionId =
    typeof body.transactionId === 'string' && body.transactionId.trim()
      ? body.transactionId.trim()
      : '';
  if (!transactionId) {
    return NextResponse.json(
      { error: 'transactionId is required' },
      { status: 400 },
    );
  }
  const rationale =
    typeof body.rationale === 'string' ? body.rationale.trim() : '';
  if (!rationale) {
    return NextResponse.json(
      { error: 'rationale is required' },
      { status: 400 },
    );
  }

  const op = await opsEngine.settlement.request({
    type,
    transactionId,
    rationale,
    requestedBy: auth.ctx.userId,
  });
  await auditOps(
    auth.ctx,
    'OPS.SETTLEMENT_OP_REQUEST',
    { opId: op.id, type, transactionId },
    op.id,
  );
  return NextResponse.json({ operation: op }, { status: 201 });
}
