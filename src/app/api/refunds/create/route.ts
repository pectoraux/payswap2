import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { refundService } from '@/services';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { validateBody, createRefundSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFUND_TYPES = new Set(['FULL', 'PARTIAL']);

/**
 * POST /api/refunds/create
 *
 * Create a Refund against an existing payment through the runtime kernel.
 *
 * This route goes through:
 *   API → refundService → executionPlanner → dispatcher → invariants →
 *   event store → ledger → projections
 *
 * The refund is recorded in the event store (refund.requested +
 * refund.executed + ledger.entry.posted events), the constitution
 * invariants are verified (including refund-limit: refund amount <=
 * payment amount), and the ledger is updated with balanced reversal
 * entries.
 *
 * Idempotency (H-2 fix — P1-4): Pass an `Idempotency-Key` header to
 * safely retry. A retry with the same key (within 24h) returns the
 * cached response with `cached: true` and does NOT create a second
 * refund.
 *
 * Body:
 *   { paymentId, amount, type: 'full' | 'partial', reason? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const userId = (session.user as any)?.id as string | undefined;
  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // H-4: Validate input with Zod schema
  const validation = validateBody(createRefundSchema, body);
  if (!validation.success) return validation.response;
  const { paymentId, type, reason } = validation.data;

  // Look up the payment and verify ownership.
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  if (payment.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Payment does not belong to this merchant' },
      { status: 403 },
    );
  }

  // Resolve the refund amount based on the type.
  let amount: number;
  if (type === 'FULL') {
    amount = Number(payment.amount);
  } else {
    const parsed = Number(body.amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: 'A valid refund amount is required for partial refunds' },
        { status: 400 },
      );
    }
    if (parsed > Number(payment.amount)) {
      return NextResponse.json(
        {
          error: `Refund amount exceeds payment amount of ${Number(payment.amount)}`,
        },
        { status: 400 },
      );
    }
    amount = parsed;
  }

  // H-2 fix: Use the client-supplied Idempotency-Key for dedup.
  // If no header was sent, `key` is null — process as unique (backwards
  // compat) and skip the wrapper.
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (idempotencyKey) {
      const result = await withIdempotency(
        idempotencyKey,
        '/api/refunds/create',
        async () => {
          const refund = await refundService.create({
            merchantId,
            paymentId,
            amount,
            type,
            reason: reason ?? '',
            environment: env,
            actorId: userId,
          });
          return { status: 201, body: { refund, idempotencyKey } };
        },
      );
      return NextResponse.json(
        { ...result.body, cached: result.cached },
        { status: result.status },
      );
    }

    // No idempotency key — process as unique (backwards compat).
    const refund = await refundService.create({
      merchantId,
      paymentId,
      amount,
      type,
      reason: reason ?? '',
      environment: env,
      actorId: userId,
    });
    return NextResponse.json(
      { refund, idempotencyKey: null, cached: false },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Refund creation failed' },
      { status: 500 },
    );
  }
}
