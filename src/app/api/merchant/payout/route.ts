import { NextRequest, NextResponse } from 'next/server';
import { payoutService } from '@/protocol/payouts/payout-service';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { merchantPlatform } from '@/protocol/merchant/platform';
import {
  requireSession,
  requireMerchantId,
  requireAdminSession,
  unauthorized,
  forbidden,
  isAdmin,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/merchant/payout — Payout / Withdrawal lifecycle.
 *
 * All actions require an authenticated session. Actions that operate on a
 * specific merchant require that the caller's merchantId matches the body's
 * `merchantId` (or that the caller is an admin).
 *
 * Actions:
 *   quote       — preview FX rate, fee, net amount (no state change)
 *   request     — create a payout (state: reviewing)
 *   process     — execute the payout (burn/transfer + external leg)
 *   cancel      — cancel a payout before processing
 *   list        — list payouts for a merchant
 *   get         — get a single payout
 *   stats       — aggregate payout stats for a merchant
 *   balance     — get the merchant's available Twin Token balance
 *
 * NOTE: The `seed` action was removed from the public API. Twin Token
 * seeding is performed exclusively by the local seed script
 * (`scripts/seed.ts`) and is not exposed over HTTP.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { action } = body;

  // Resolve the caller's merchantId once. Admins are allowed to act on any
  // merchant; everyone else may only act on their own merchantId.
  const callerMerchantId = await requireMerchantId();
  const admin = await isAdmin();

  function ownsMerchant(merchantId: string | undefined): boolean {
    if (!merchantId) return false;
    if (admin) return true;
    return callerMerchantId === merchantId;
  }

  // For per-payout actions (process / cancel / get) we resolve the payout
  // first and check ownership via its merchantId.
  function ownsPayout(payout: { merchantId?: string } | null | undefined): boolean {
    if (!payout) return false;
    return ownsMerchant(payout.merchantId);
  }

  if (action === 'quote') {
    if (!ownsMerchant(body.merchantId)) return forbidden();
    try {
      const quote = await payoutService.quote({
        merchantId: body.merchantId,
        method: body.method,
        sourceAsset: body.sourceAsset,
        sourceAmount: Number(body.sourceAmount),
        sourceCurrency: body.sourceCurrency,
        destinationCurrency: body.destinationCurrency,
      });
      return NextResponse.json({ quote });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Quote failed' }, { status: 400 });
    }
  }

  if (action === 'request') {
    if (!ownsMerchant(body.merchantId)) return forbidden();
    try {
      const payout = await payoutService.request({
        merchantId: body.merchantId,
        method: body.method,
        sourceAsset: body.sourceAsset,
        sourceAmount: Number(body.sourceAmount),
        sourceCurrency: body.sourceCurrency,
        destinationCurrency: body.destinationCurrency,
        destination: body.destination,
        note: body.note,
      });
      return NextResponse.json({ payout });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status: 400 });
    }
  }

  if (action === 'process') {
    try {
      const payout = payoutService.get(body.payoutId);
      if (!ownsPayout(payout)) return forbidden();
      const processed = await payoutService.process(body.payoutId);
      return NextResponse.json({ payout: processed });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Process failed' }, { status: 400 });
    }
  }

  if (action === 'cancel') {
    try {
      const payout = payoutService.get(body.payoutId);
      if (!ownsPayout(payout)) return forbidden();
      const cancelled = payoutService.cancel(body.payoutId, body.reason ?? 'Cancelled by merchant');
      return NextResponse.json({ payout: cancelled });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Cancel failed' }, { status: 400 });
    }
  }

  if (action === 'list') {
    if (!ownsMerchant(body.merchantId)) return forbidden();
    const payouts = payoutService.list({ merchantId: body.merchantId });
    return NextResponse.json({ payouts });
  }

  if (action === 'get') {
    const payout = payoutService.get(body.payoutId);
    if (!payout) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!ownsPayout(payout)) return forbidden();
    return NextResponse.json({ payout });
  }

  if (action === 'stats') {
    if (!ownsMerchant(body.merchantId)) return forbidden();
    const stats = payoutService.stats(body.merchantId);
    return NextResponse.json({ stats });
  }

  if (action === 'balance') {
    if (!ownsMerchant(body.merchantId)) return forbidden();
    const merchant = merchantPlatform.getMerchant(body.merchantId);
    const currency = merchant?.currency ?? body.currency ?? 'GHS';
    const assetCode = `TWIN${currency}`;
    const balance = twinTokenEngine.getBalance(`merchant:${body.merchantId}`, assetCode);
    const asset = twinTokenEngine.getAsset(assetCode);
    return NextResponse.json({
      assetCode,
      balance: balance ? balance.balance : 0,
      available: payoutService.availableBalance(body.merchantId, assetCode),
      escrowed: balance ? balance.escrowed : 0,
      frozen: balance ? balance.frozen : 0,
      asset,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/**
 * GET /api/merchant/payout — list recent payouts.
 *
 * When `merchantId` is supplied, the caller must own that merchant (or be an
 * admin). Without `merchantId`, the call is admin-only (cross-merchant
 * listing).
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const url = new URL(req.url);
  const merchantId = url.searchParams.get('merchantId') ?? undefined;

  const callerMerchantId = await requireMerchantId();
  const admin = await isAdmin();

  if (merchantId) {
    if (!admin && callerMerchantId !== merchantId) return forbidden();
    return NextResponse.json({ payouts: payoutService.list({ merchantId }) });
  }

  // Cross-merchant listing is admin-only.
  if (!admin) return forbidden();
  return NextResponse.json({ payouts: payoutService.list({}) });
}
