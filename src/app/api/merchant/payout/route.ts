import { NextRequest, NextResponse } from 'next/server';
import { payoutService, type PayoutMethod } from '@/protocol/payouts/payout-service';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { requireSession, requireMerchantOwnership } from '@/lib/merchant-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Auth (C-6 / P1-2 fix):
 * - The blanket middleware requires a valid NextAuth JWT for every
 *   non-public `/api/*` route.
 * - On top of that, any action that takes a `merchantId` parameter
 *   verifies the caller owns that merchant (or is an admin). This
 *   closes the cross-merchant IDOR: a logged-in merchant can no longer
 *   trigger payouts, quotes, or balance reads against another merchant.
 * - Actions that take a `payoutId` (process / cancel / get) resolve the
 *   payout's owning merchant from the payout record itself and then
 *   run the same ownership check.
 */

/** GET /api/merchant/payout — list payouts (optional merchantId filter). */
export async function GET(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  const merchantId = req.nextUrl.searchParams.get('merchantId') ?? undefined;
  const state = req.nextUrl.searchParams.get('state') as PayoutMethod | undefined;

  // When a merchantId filter is supplied, verify ownership.
  if (merchantId) {
    const forbidden = await requireMerchantOwnership(merchantId, session);
    if (forbidden) return forbidden;
  }

  const payouts = payoutService.list({ merchantId, state: state as any });
  return NextResponse.json({ payouts, count: payouts.length });
}

/** POST /api/merchant/payout — action dispatcher. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const action = body?.action as string | undefined;

  // ---- Session check (always). ----
  const { session, error } = await requireSession();
  if (error) return error;

  // ---- Merchant ownership check (for actions that take merchantId). ----
  // Actions that accept a `merchantId` in the body: quote, request, list,
  // stats, balance, seed. For these we verify the caller owns that
  // merchant before dispatching.
  const MERCHANT_ACTIONS = new Set(['quote', 'request', 'list', 'stats', 'balance', 'seed']);
  if (MERCHANT_ACTIONS.has(action ?? '')) {
    const merchantId = body?.merchantId as string | undefined;
    if (merchantId) {
      const forbidden = await requireMerchantOwnership(merchantId, session);
      if (forbidden) return forbidden;
    }
  }
  // Actions that take a `payoutId` (process / cancel / get) resolve the
  // owning merchant from the payout record and verify ownership below.
  const PAYOUT_ACTIONS = new Set(['process', 'cancel', 'get']);
  if (PAYOUT_ACTIONS.has(action ?? '')) {
    const payoutId = body?.payoutId as string | undefined;
    if (payoutId) {
      const payout = payoutService.get(payoutId);
      if (payout?.merchantId) {
        const forbidden = await requireMerchantOwnership(payout.merchantId, session);
        if (forbidden) return forbidden;
      }
    }
  }

  try {
    switch (action) {
      case 'quote': {
        const { merchantId, method, sourceAsset, sourceAmount, sourceCurrency, destinationCurrency } = body;
        if (!merchantId || !method || !sourceAsset || sourceAmount == null || !sourceCurrency || !destinationCurrency) {
          return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
        }
        const q = await payoutService.quote({
          merchantId, method,
          sourceAsset,
          sourceAmount: Number(sourceAmount),
          sourceCurrency,
          destinationCurrency,
        });
        return NextResponse.json({ quote: q });
      }
      case 'request': {
        const { merchantId, method, sourceAsset, sourceAmount, sourceCurrency, destinationCurrency, destination, note } = body;
        if (!merchantId || !method || !sourceAsset || sourceAmount == null || !sourceCurrency || !destinationCurrency || !destination) {
          return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
        }
        const p = await payoutService.request({
          merchantId, method,
          sourceAsset,
          sourceAmount: Number(sourceAmount),
          sourceCurrency, destinationCurrency,
          destination, note,
        });
        return NextResponse.json({ payout: p });
      }
      case 'process': {
        const { payoutId } = body;
        if (!payoutId) return NextResponse.json({ error: 'missing_payoutId' }, { status: 400 });
        const p = await payoutService.process(payoutId);
        return NextResponse.json({ payout: p });
      }
      case 'cancel': {
        const { payoutId, reason } = body;
        if (!payoutId) return NextResponse.json({ error: 'missing_payoutId' }, { status: 400 });
        const p = payoutService.cancel(payoutId, reason ?? 'cancelled');
        if (!p) return NextResponse.json({ error: 'cannot_cancel' }, { status: 400 });
        return NextResponse.json({ payout: p });
      }
      case 'list': {
        const { merchantId, state } = body;
        const payouts = payoutService.list({ merchantId, state });
        return NextResponse.json({ payouts, count: payouts.length });
      }
      case 'get': {
        const { payoutId } = body;
        const p = payoutService.get(payoutId);
        if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
        return NextResponse.json({ payout: p });
      }
      case 'stats': {
        const { merchantId } = body;
        if (!merchantId) return NextResponse.json({ error: 'missing_merchantId' }, { status: 400 });
        const stats = payoutService.stats(merchantId);
        return NextResponse.json({ stats });
      }
      case 'balance': {
        const { merchantId, currency } = body;
        if (!merchantId) return NextResponse.json({ error: 'missing_fields', required: ['merchantId'] }, { status: 400 });
        const assetCode = body.assetCode ?? `TWIN${currency ?? 'GHS'}`;
        const rec = twinTokenEngine.getBalanceRecord(payoutService.holder(merchantId), assetCode);
        const available = twinTokenEngine.getAvailableBalance(payoutService.holder(merchantId), assetCode);
        return NextResponse.json({
          assetCode,
          balance: rec.balance,
          available,
          escrowed: rec.escrowed,
          frozen: rec.frozen,
          asset: twinTokenEngine.getAsset(assetCode),
        });
      }
      case 'seed': {
        const { merchantId, amount, currency, assetCode: ac, corridor, issuer } = body;
        if (!merchantId || amount == null || !currency) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'amount', 'currency'] }, { status: 400 });
        }
        const assetCode = ac ?? `TWIN${currency}`;
        // Ensure the asset exists.
        twinTokenEngine.registerAsset(currency, corridor ?? 'SEED-CORRIDOR', issuer ?? `G${currency.toUpperCase()}ISSUERXXXXXXXXXXXXXXXXXXXX`);
        const res = await payoutService.creditMerchant(merchantId, assetCode, Number(amount), 'seed');
        if (!res.success) return NextResponse.json({ error: res.error ?? 'seed_failed' }, { status: 400 });
        const bal = twinTokenEngine.getBalance(payoutService.holder(merchantId), assetCode);
        const available = twinTokenEngine.getAvailableBalance(payoutService.holder(merchantId), assetCode);
        return NextResponse.json({
          ok: true,
          txHash: res.txHash,
          assetCode, balance: bal, available,
          asset: twinTokenEngine.getAsset(assetCode),
        });
      }
      default:
        return NextResponse.json({ error: 'unknown_action', action }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: 'server_error', message: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
