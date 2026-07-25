import { NextRequest, NextResponse } from 'next/server';
import { payoutService } from '@/protocol/payouts/payout-service';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { merchantPlatform } from '@/protocol/merchant/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/merchant/payout — Payout / Withdrawal lifecycle.
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
 *   seed        — credit the merchant with Twin Tokens (demo only)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === 'quote') {
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
      const payout = await payoutService.process(body.payoutId);
      return NextResponse.json({ payout });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Process failed' }, { status: 400 });
    }
  }

  if (action === 'cancel') {
    try {
      const payout = payoutService.cancel(body.payoutId, body.reason ?? 'Cancelled by merchant');
      return NextResponse.json({ payout });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Cancel failed' }, { status: 400 });
    }
  }

  if (action === 'list') {
    const payouts = payoutService.list({ merchantId: body.merchantId });
    return NextResponse.json({ payouts });
  }

  if (action === 'get') {
    const payout = payoutService.get(body.payoutId);
    if (!payout) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ payout });
  }

  if (action === 'stats') {
    const stats = payoutService.stats(body.merchantId);
    return NextResponse.json({ stats });
  }

  if (action === 'balance') {
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

  if (action === 'seed') {
    // Demo helper: credit the merchant with Twin Tokens so they can test payouts.
    try {
      const merchant = merchantPlatform.getMerchant(body.merchantId);
      const currency = merchant?.currency ?? body.currency ?? 'GHS';
      const assetCode = `TWIN${currency}`;
      let asset = twinTokenEngine.getAsset(assetCode);
      if (!asset) {
        asset = await twinTokenEngine.registerAsset(currency, `${currency}-USD corridor`, `G${currency.toUpperCase()}ISSUERXXXXXXXXXXXXXXXXXXXX`);
      }
      await payoutService.creditMerchant(body.merchantId, assetCode, Number(body.amount ?? 10000), 'Demo seed');
      const balance = twinTokenEngine.getBalance(`merchant:${body.merchantId}`, assetCode);
      return NextResponse.json({
        assetCode,
        balance: balance ? balance.balance : 0,
        available: payoutService.availableBalance(body.merchantId, assetCode),
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Seed failed' }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET /api/merchant/payout — list recent payouts across all merchants */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const merchantId = url.searchParams.get('merchantId') ?? undefined;
  return NextResponse.json({ payouts: payoutService.list({ merchantId }) });
}
