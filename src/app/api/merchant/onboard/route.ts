import { NextRequest, NextResponse } from 'next/server';
import { merchantPlatform } from '@/protocol/merchant/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/merchant/onboard — full merchant onboarding lifecycle */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === 'onboard') {
    const merchant = merchantPlatform.onboard({
      name: body.name, email: body.email, country: body.country, currency: body.currency,
    });
    return NextResponse.json({ merchant });
  }

  if (action === 'verify') {
    const merchant = merchantPlatform.verify(body.merchantId, body.bond ?? 5000);
    return NextResponse.json({ merchant });
  }

  if (action === 'create_api_key') {
    const apiKey = merchantPlatform.createApiKey(body.merchantId, body.label ?? 'Default', body.scopes);
    return NextResponse.json({ apiKey });
  }

  if (action === 'setup_webhook') {
    const result = merchantPlatform.setupWebhook(body.merchantId, body.url, body.events);
    return NextResponse.json(result);
  }

  if (action === 'create_product') {
    const product = merchantPlatform.createProduct(body.merchantId, {
      name: body.name, description: body.description, price: body.price, currency: body.currency,
    });
    return NextResponse.json({ product });
  }

  if (action === 'create_invoice') {
    const invoice = merchantPlatform.createInvoice(body.merchantId, {
      customerId: body.customerId, items: body.items, tax: body.tax, currency: body.currency, dueDate: body.dueDate,
    });
    return NextResponse.json({ invoice });
  }

  if (action === 'create_customer') {
    const customer = merchantPlatform.createCustomer(body.merchantId, {
      name: body.name, email: body.email, phone: body.phone,
    });
    return NextResponse.json({ customer });
  }

  if (action === 'analytics') {
    const analytics = merchantPlatform.getAnalytics(body.merchantId);
    return NextResponse.json({ analytics });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET /api/merchant/onboard — list all merchants */
export async function GET() {
  return NextResponse.json({ merchants: merchantPlatform.allMerchants() });
}
