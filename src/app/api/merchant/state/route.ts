import { NextRequest, NextResponse } from 'next/server';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { payoutService } from '@/protocol/payouts/payout-service';
import { webhookEngine } from '@/protocol/webhooks/engine';
import { eventEngine } from '@/kernel/event';
import { stellarAdapter } from '@/protocol/blockchains/stellar/adapter';
import { blockchainRegistry } from '@/protocol/blockchains/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let stellarRegistered = false;
function initStellar() {
  if (stellarRegistered) return;
  blockchainRegistry.register(stellarAdapter);
  stellarRegistered = true;
}

/**
 * GET /api/merchant/state?merchantId=...
 *
 * Returns the complete merchant dashboard state in a single round-trip:
 *   - merchant account
 *   - API keys
 *   - team
 *   - products
 *   - invoices
 *   - customers
 *   - refunds
 *   - analytics
 *   - twin token balance + asset info
 *   - recent twin token operations
 *   - payouts (list + stats)
 *   - webhook endpoints + recent deliveries
 *   - recent protocol events (merchant.* / payout.* / twintoken.*)
 */
export async function GET(req: NextRequest) {
  initStellar();
  const url = new URL(req.url);
  const merchantId = url.searchParams.get('merchantId');

  if (!merchantId) {
    return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
  }

  const merchant = merchantPlatform.getMerchant(merchantId);
  if (!merchant) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  const currency = merchant.currency;
  const assetCode = `TWIN${currency}`;
  const holder = `merchant:${merchantId}`;

  // Ensure asset exists for the merchant's currency
  let asset = twinTokenEngine.getAsset(assetCode);
  if (!asset) {
    asset = await twinTokenEngine.registerAsset(
      currency,
      `${currency}-USD corridor`,
      `G${currency.toUpperCase()}ISSUERXXXXXXXXXXXXXXXXXXXX`,
    );
  }
  const balance = twinTokenEngine.getBalance(holder, assetCode);
  const operations = twinTokenEngine.getOperations({ holder }).slice(0, 12);

  // Payouts
  const payouts = payoutService.list({ merchantId }).slice(0, 25);
  const payoutStats = payoutService.stats(merchantId);

  // Webhooks
  const webhookEndpoints = webhookEngine.getEndpointsByMerchant(merchantId);
  const webhookDeliveries = webhookEndpoints
    .flatMap((ep) => webhookEngine.getDeliveries(ep.id))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 25);

  // Recent protocol events (filtered to this merchant)
  const allEvents = eventEngine.read();
  const events = allEvents
    .filter((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.merchantId === merchantId || p.accountId === merchantId;
    })
    .slice(-40)
    .reverse();

  // Analytics
  const analytics = merchantPlatform.getAnalytics(merchantId);

  return NextResponse.json({
    merchant,
    apiKeys: merchant.apiKeys,
    team: merchant.team,
    settings: merchant.settings,
    products: merchantPlatform.getProducts(merchantId),
    invoices: merchantPlatform.getInvoices(merchantId),
    customers: merchantPlatform.getCustomers(merchantId),
    refunds: merchantPlatform.getRefunds(merchantId),
    analytics,
    twinToken: {
      asset,
      balance: balance ? balance.balance : 0,
      available: balance ? balance.available : 0,
      escrowed: balance ? balance.escrowed : 0,
      frozen: balance ? balance.frozen : 0,
      operations,
    },
    payouts,
    payoutStats,
    webhooks: {
      endpoints: webhookEndpoints,
      deliveries: webhookDeliveries,
    },
    events,
  });
}
