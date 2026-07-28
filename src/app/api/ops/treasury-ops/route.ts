import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set([
  'reserve_adjustment',
  'rebalance',
  'withdrawal',
  'deposit',
  'fx_hedge',
]);

/**
 * GET /api/ops/treasury-ops — list treasury operations.
 *
 * Query params:
 *   - status: pending | approved | executed | failed | reversed
 *   - type: reserve_adjustment | rebalance | withdrawal | deposit | fx_hedge
 *   - pending: '1' — return only pending operations
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  if (url.searchParams.get('pending') === '1') {
    const pending = await opsEngine.treasury.getPending();
    return NextResponse.json({ operations: pending });
  }
  const status = url.searchParams.get('status') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  if (type && !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  const operations = await opsEngine.treasury.list({ status, type });
  return NextResponse.json({ operations });
}

/**
 * POST /api/ops/treasury-ops — request a new treasury operation.
 *
 * Body: { type, country, currency, amount, rationale }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    type?: string;
    country?: string;
    currency?: string;
    amount?: number;
    rationale?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const type =
    typeof body.type === 'string' && VALID_TYPES.has(body.type)
      ? (body.type as 'reserve_adjustment' | 'rebalance' | 'withdrawal' | 'deposit' | 'fx_hedge')
      : null;
  if (!type) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  const country =
    typeof body.country === 'string' && body.country.trim()
      ? body.country.trim().toUpperCase()
      : '';
  if (!country) {
    return NextResponse.json({ error: 'country is required' }, { status: 400 });
  }
  const currency =
    typeof body.currency === 'string' && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : '';
  if (!currency) {
    return NextResponse.json({ error: 'currency is required' }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'amount must be a positive number' },
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

  const op = await opsEngine.treasury.request({
    type,
    country,
    currency,
    amount,
    rationale,
    requestedBy: auth.ctx.userId,
  });
  await auditOps(
    auth.ctx,
    'OPS.TREASURY_OP_REQUEST',
    { opId: op.id, type, country, currency, amount },
    op.id,
  );
  return NextResponse.json({ operation: op }, { status: 201 });
}
