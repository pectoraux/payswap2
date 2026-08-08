import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';
import { payoutService } from '@/services';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { validateBody, createPayoutSchema } from '@/lib/validation';

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
 * Idempotency (H-2 fix — P1-4): Pass an `Idempotency-Key` header to
 * safely retry. A retry with the same key (within 24h) returns the
 * cached response with `cached: true` and does NOT create a second
 * payout. If no header is sent, the request is processed as unique
 * (backwards compat) and `cached: false` is returned.
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

  // H-4: Validate input with Zod schema
  const validation = validateBody(createPayoutSchema, body);
  if (!validation.success) return validation.response;
  const { method, sourceAmount, sourceCurrency } = validation.data;

  // H-2 fix: Use the client-supplied Idempotency-Key for dedup.
  // If no header was sent, `key` is null — we process the request as
  // unique (backwards compat) and skip the wrapper.
  const idempotencyKey = getIdempotencyKey(req);

  try {
    // The side-effect (payoutService.create) is wrapped in withIdempotency
    // so a retry with the same key returns the cached payout without
    // creating a second record.
    if (idempotencyKey) {
      const result = await withIdempotency(
        idempotencyKey,
        '/api/payouts/create',
        async () => {
          const payout = await payoutService.create({
            merchantId,
            method,
            amount: sourceAmount,
            currency: sourceCurrency,
            environment: env,
            actorId: (session.user as any)?.id,
          });
          return { status: 201, body: { payout, idempotencyKey } };
        },
      );
      return NextResponse.json(
        { ...result.body, cached: result.cached },
        { status: result.status },
      );
    }

    // No idempotency key — process as unique (backwards compat).
    const payout = await payoutService.create({
      merchantId,
      method,
      amount: sourceAmount,
      currency: sourceCurrency,
      environment: env,
      actorId: (session.user as any)?.id,
    });
    return NextResponse.json(
      { payout, idempotencyKey: null, cached: false },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payout creation failed' },
      { status: 500 },
    );
  }
}
