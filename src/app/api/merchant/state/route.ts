import { NextRequest, NextResponse } from 'next/server';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { payoutService } from '@/protocol/payouts/payout-service';
import { webhookEngine } from '@/protocol/webhooks/engine';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { eventEngine } from '@/kernel/event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/merchant/state?merchantId=... — full dashboard state. */
export async function GET(req: NextRequest) {
  const merchantId = req.nextUrl.searchParams.get('merchantId');
  if (!merchantId) return NextResponse.json({ error: 'missing_merchantId' }, { status: 400 });

  const merchant = merchantPlatform.getMerchant(merchantId);
  if (!merchant) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });

  const apiKeys = merchantPlatform.getApiKeys(merchantId);
  const team = merchantPlatform.getTeam(merchantId);
  const products = merchantPlatform.getProducts(merchantId);
  const invoices = merchantPlatform.getInvoices(merchantId);
  const customers = merchantPlatform.getCustomers(merchantId);
  const refunds = merchantPlatform.getRefunds(merchantId);
  const analytics = merchantPlatform.getAnalytics(merchantId);

  // Twin token: find assets whose holder has any balance for this merchant.
  const holder = payoutService.holder(merchantId);
  const assets = twinTokenEngine.allAssets();
  const twinToken = {
    assets,
    balances: assets.map((a) => ({
      assetCode: a.code,
      currency: a.currency,
      balance: twinTokenEngine.getBalance(holder, a.code),
      available: twinTokenEngine.getAvailableBalance(holder, a.code),
      record: twinTokenEngine.getBalanceRecord(holder, a.code),
    })),
    operations: twinTokenEngine.getOperations({ holder }),
  };

  const payouts = payoutService.list({ merchantId });
  const payoutStats = payoutService.stats(merchantId);

  const endpoints = webhookEngine.getEndpointsByMerchant(merchantId);
  const deliveries = webhookEngine.allDeliveries().filter((d) => d.merchantId === merchantId);

  // Merchant-filtered event log.
  const events = eventEngine
    .read()
    .filter((e) => {
      const p = e.payload as any;
      return p?.merchantId === merchantId
        || p?.merchant === merchantId
        || p?.holder === holder
        || (typeof p?.to === 'string' && p.to === holder)
        || (typeof p?.from === 'string' && p.from === holder);
    })
    .slice(-200)
    .reverse();

  return NextResponse.json({
    merchant,
    apiKeys,
    team,
    settings: merchant.settings,
    products,
    invoices,
    customers,
    refunds,
    analytics,
    twinToken,
    payouts,
    payoutStats,
    webhooks: { endpoints, deliveries },
    events,
  });
}
