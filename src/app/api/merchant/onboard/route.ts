import { NextRequest, NextResponse } from 'next/server';
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
 * POST /api/merchant/onboard — full merchant onboarding lifecycle.
 *
 * Every action requires an authenticated session. Actions that operate on an
 * existing merchant (verify, create_api_key, setup_webhook, create_product,
 * create_invoice, create_customer, analytics) additionally require that the
 * caller's merchantId matches the resource merchantId, or that the caller is
 * an admin. The `onboard` action is available to any authenticated user
 * (it creates a brand-new merchant).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { action } = body;

  // Helper: ensure the caller may operate on `body.merchantId`.
  async function canAccessMerchant(merchantId: string | undefined): Promise<boolean> {
    if (!merchantId) return false;
    if (await isAdmin()) return true;
    const callerMerchantId = await requireMerchantId();
    return callerMerchantId === merchantId;
  }

  if (action === 'onboard') {
    const merchant = merchantPlatform.onboard({
      name: body.name, email: body.email, country: body.country, currency: body.currency,
    });
    return NextResponse.json({ merchant });
  }

  if (action === 'verify') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const merchant = merchantPlatform.verify(body.merchantId, body.bond ?? 5000);
    return NextResponse.json({ merchant });
  }

  if (action === 'create_api_key') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const apiKey = merchantPlatform.createApiKey(body.merchantId, body.label ?? 'Default', body.scopes);
    return NextResponse.json({ apiKey });
  }

  if (action === 'setup_webhook') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const result = merchantPlatform.setupWebhook(body.merchantId, body.url, body.events);
    return NextResponse.json(result);
  }

  if (action === 'create_product') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const product = merchantPlatform.createProduct(body.merchantId, {
      name: body.name, description: body.description, price: body.price, currency: body.currency,
    });
    return NextResponse.json({ product });
  }

  if (action === 'create_invoice') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const invoice = merchantPlatform.createInvoice(body.merchantId, {
      customerId: body.customerId, items: body.items, tax: body.tax, currency: body.currency, dueDate: body.dueDate,
    });
    return NextResponse.json({ invoice });
  }

  if (action === 'create_customer') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const customer = merchantPlatform.createCustomer(body.merchantId, {
      name: body.name, email: body.email, phone: body.phone,
    });
    return NextResponse.json({ customer });
  }

  if (action === 'analytics') {
    if (!(await canAccessMerchant(body.merchantId))) return forbidden();
    const analytics = merchantPlatform.getAnalytics(body.merchantId);
    return NextResponse.json({ analytics });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/**
 * GET /api/merchant/onboard — list all merchants.
 *
 * Restricted to admins. Merchants should use /api/merchant/state?merchantId=
 * to read their own record.
 */
export async function GET() {
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  return NextResponse.json({ merchants: merchantPlatform.allMerchants() });
}
