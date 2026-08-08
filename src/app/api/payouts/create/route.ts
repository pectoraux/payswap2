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
import { guardLiveMoney, constitutionBlockBody } from '@/lib/constitution-guard';
import { writeAudit } from '@/lib/audit-log';
import { ledgerEngine } from '@/protocol/ledger';
import { debit, credit } from '@/protocol/ledger/entry';

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
  const { method, sourceAmount, sourceCurrency, destination } = validation.data;

  // P2-4 (C-7 fix) + P3-4 (H-8 fix): Run the CRITICAL subset of the
  // Constitution BEFORE creating the payout. Sanctions + KYC + per-tx
  // amount cap apply on money-OUT. Runs only 8 of 45 rules (< 1ms).
  //
  // P3-4 (H-8): the sanctions screen now goes through the CANONICAL
  // `src/trust/sanctions-screener.ts` stack (via the wrapper that the
  // constitution's `cmp-sanctions-screen` rule imports). The payout's
  // `destination` (bank account number / mobile-money phone / onchain
  // address) is screened AS the counterparty name — the fuzzy matcher
  // won't match opaque IDs, but if a payout destination string contains
  // a sanctioned human-readable name (e.g. "Account of KIM JONG UN"),
  // it WILL be caught. A real sanctions feed (Chainalysis KYT) would
  // additionally resolve the destination to a known counterparty + its
  // registered names — wired via `PAYSWAP_SANCTIONS_LIST_FILE`.
  const verdict = guardLiveMoney({
    actor: {
      id: (session.user as any)?.id ?? 'unknown',
      role: 'MERCHANT',
    },
    // Screen the payout destination as the counterparty. The constitution's
    // cmp-sanctions-screen rule screens both actor + counterparty; if either
    // has an active sanctions hit, the payout is blocked with 403.
    counterparty: destination
      ? { id: destination, name: destination }
      : undefined,
    amount: sourceAmount,
    currency: sourceCurrency,
    transactionType: 'payout',
  });
  if (!verdict.passed) {
    return NextResponse.json(constitutionBlockBody(verdict), { status: 403 });
  }

  // H-2 fix: Use the client-supplied Idempotency-Key for dedup.
  // If no header was sent, `key` is null — we process the request as
  // unique (backwards compat) and skip the wrapper.
  const idempotencyKey = getIdempotencyKey(req);

  try {
    // The side-effect (payoutService.create) is wrapped in withIdempotency
    // so a retry with the same key returns the cached payout without
    // creating a second record.
    // P3-5 (H-9 fix): Audit-log every successful payout creation.
    // Best-effort: a failure here MUST NOT fail the payout. The payout
    // is already committed by payoutService.create (events dispatched +
    // ledger posted) — the audit log is a forensic record, not a guard.
    const writePayoutAudit = (payout: { id: string }) =>
      writeAudit({
        userId: (session.user as any)?.id ?? null,
        action: 'PAYOUT_CREATE',
        resourceType: 'Payout',
        resourceId: payout.id,
        result: 'SUCCESS',
        details: {
          amount: sourceAmount,
          currency: sourceCurrency,
          method,
          merchantId,
          environment: env,
        },
      });

    // ── P2-1 (C-4 fix): post a balanced journal entry to the protocol ledger.
    // DR merchant:payable:<merchantId> (liability decreases — money leaving
    //                                          the merchant's payable balance)
    // CR payout:pending               (liability increases — money now owed
    //                                          to the payee through the rail)
    // Both legs are liabilities → net L change = 0 → A=L+E preserved.
    // Best-effort: a ledger write failure does NOT block the payout.
    const postPayoutLedger = (payout: {
      id: string;
      txHash: string | null;
    }) =>
      ledgerEngine.postAndPersist({
        txId: payout.txHash ?? payout.id,
        description: `Payout ${sourceAmount} ${sourceCurrency} via ${method}`,
        legs: [
          debit(
            `merchant:payable:${merchantId}`,
            sourceAmount,
            sourceCurrency,
            `Payout ${payout.id} via ${method}`,
          ),
          credit(
            'payout:pending',
            sourceAmount,
            sourceCurrency,
            `Payout ${payout.id} pending rail`,
          ),
        ],
      }).catch((ledgerErr: unknown) => {
        console.error('[payouts/create] Ledger post failed (payout succeeded):', ledgerErr);
      });

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
          // The audit log is written INSIDE the wrapper so a cache hit
          // (retry with same key) does NOT produce a duplicate entry.
          await writePayoutAudit(payout);
          // P2-1: ledger post is also inside the wrapper for the same reason.
          await postPayoutLedger(payout);
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
    await writePayoutAudit(payout);
    await postPayoutLedger(payout);
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
