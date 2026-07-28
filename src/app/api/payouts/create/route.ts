import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';
import { payoutService } from '@/services';
import { getIdempotencyKey } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = new Set(['bank', 'mobile_money', 'onchain']);

/**
 * POST /api/payouts/create
 *
 * Create a Payout (withdrawal) through the runtime kernel.
 *
 * This route goes through:
 *   API → payoutService → executionPlanner → dispatcher → invariants →
 *   event store → ledger → projections
 *
 * The payout is recorded in the event store (payout.recorded +
 * payout.completed + ledger.entry.posted events), the constitution
 * invariants are verified, and the ledger is updated with balanced
 * double-entry journal entries.
 *
 * Idempotency: Pass an `Idempotency-Key` header to safely retry.
 *
 * Body:
 *   { method, sourceAmount, sourceCurrency, destinationCurrency, destination }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const method = typeof body.method === 'string' ? body.method : '';
  const sourceAmount = Number(body.sourceAmount);
  const sourceCurrency =
    typeof body.sourceCurrency === 'string' ? body.sourceCurrency : 'GHS';

  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { error: 'Invalid payout method' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  // Get idempotency key from header (H-2 fix)
  const idempotencyKey = getIdempotencyKey(req);

  try {
    const payout = await payoutService.create({
      merchantId,
      method,
      amount: sourceAmount,
      currency: sourceCurrency,
      environment: env,
      actorId: (session.user as any)?.id,
    });

    return NextResponse.json({ payout, idempotencyKey }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payout creation failed' },
      { status: 500 },
    );
  }
}
