import { NextRequest, NextResponse } from 'next/server';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { webhookEngine } from '@/protocol/webhooks/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/merchant/onboard — list all merchants. */
export async function GET() {
  const merchants = merchantPlatform.allMerchants();
  return NextResponse.json({ merchants, count: merchants.length });
}

/** POST /api/merchant/onboard — action dispatcher. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const action = body?.action as string | undefined;
  try {
    switch (action) {
      case 'onboard': {
        const { name, email, country, currency } = body;
        if (!name || !email || !country || !currency) {
          return NextResponse.json({ error: 'missing_fields', required: ['name', 'email', 'country', 'currency'] }, { status: 400 });
        }
        const m = merchantPlatform.onboard({ name, email, country, currency });
        return NextResponse.json({ merchant: m });
      }
      case 'verify': {
        const { merchantId, bond } = body;
        if (!merchantId || bond == null) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'bond'] }, { status: 400 });
        }
        const m = merchantPlatform.verify(merchantId, Number(bond));
        if (!m) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ merchant: m });
      }
      case 'create_api_key': {
        const { merchantId, label, scopes } = body;
        if (!merchantId || !label) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'label'] }, { status: 400 });
        }
        const k = merchantPlatform.createApiKey(merchantId, label, scopes);
        if (!k) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ apiKey: k });
      }
      case 'revoke_api_key': {
        const { merchantId, keyId } = body;
        const ok = merchantPlatform.revokeApiKey(merchantId, keyId);
        if (!ok) return NextResponse.json({ error: 'not_found_or_inactive' }, { status: 404 });
        return NextResponse.json({ ok });
      }
      case 'setup_webhook': {
        const { merchantId, url, events } = body;
        if (!merchantId || !url) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'url'] }, { status: 400 });
        }
        const r = merchantPlatform.setupWebhook(merchantId, url, events);
        if (!r) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ endpointId: r.endpointId, secret: r.secret });
      }
      case 'create_product': {
        const { merchantId, name, description, price, currency, metadata } = body;
        if (!merchantId || !name || price == null || !currency) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'name', 'price', 'currency'] }, { status: 400 });
        }
        const p = merchantPlatform.createProduct(merchantId, { name, description: description ?? '', price: Number(price), currency, metadata });
        if (!p) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ product: p });
      }
      case 'create_invoice': {
        const { merchantId, customerId, items, tax, currency, dueDate } = body;
        if (!merchantId || !customerId || !Array.isArray(items) || !currency || !dueDate) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'customerId', 'items', 'currency', 'dueDate'] }, { status: 400 });
        }
        const inv = merchantPlatform.createInvoice(merchantId, { customerId, items, tax, currency, dueDate });
        if (!inv) return NextResponse.json({ error: 'merchant_or_customer_not_found' }, { status: 404 });
        return NextResponse.json({ invoice: inv });
      }
      case 'send_invoice': {
        const { invoiceId } = body;
        const inv = merchantPlatform.sendInvoice(invoiceId);
        if (!inv) return NextResponse.json({ error: 'invoice_not_found_or_not_draft' }, { status: 404 });
        return NextResponse.json({ invoice: inv });
      }
      case 'pay_invoice': {
        const { invoiceId, paymentId } = body;
        const inv = merchantPlatform.payInvoice(invoiceId, paymentId);
        if (!inv) return NextResponse.json({ error: 'invoice_not_found_or_not_sent' }, { status: 404 });
        return NextResponse.json({ invoice: inv });
      }
      case 'create_customer': {
        const { merchantId, name, email, phone } = body;
        if (!merchantId || !name || !email) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'name', 'email'] }, { status: 400 });
        }
        const c = merchantPlatform.createCustomer(merchantId, { name, email, phone });
        if (!c) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ customer: c });
      }
      case 'create_refund': {
        const { merchantId, paymentId, amount, currency, reason } = body;
        if (!merchantId || !paymentId || amount == null || !currency || !reason) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'paymentId', 'amount', 'currency', 'reason'] }, { status: 400 });
        }
        const r = merchantPlatform.createRefund(merchantId, paymentId, Number(amount), currency, reason);
        if (!r) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ refund: r });
      }
      case 'process_refund': {
        const { refundId, approved } = body;
        const r = merchantPlatform.processRefund(refundId, !!approved);
        if (!r) return NextResponse.json({ error: 'refund_not_found' }, { status: 404 });
        return NextResponse.json({ refund: r });
      }
      case 'invite_team': {
        const { merchantId, email, role } = body;
        if (!merchantId || !email || !role) {
          return NextResponse.json({ error: 'missing_fields', required: ['merchantId', 'email', 'role'] }, { status: 400 });
        }
        const t = merchantPlatform.inviteTeamMember(merchantId, email, role);
        if (!t) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ teamMember: t });
      }
      case 'suspend': {
        const { merchantId, reason } = body;
        const m = merchantPlatform.suspend(merchantId, reason ?? 'no_reason');
        if (!m) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ merchant: m });
      }
      case 'analytics': {
        const { merchantId } = body;
        const a = merchantPlatform.getAnalytics(merchantId);
        if (!a) return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 });
        return NextResponse.json({ analytics: a });
      }
      case 'list_webhooks': {
        const { merchantId } = body;
        const endpoints = webhookEngine.getEndpointsByMerchant(merchantId);
        const deliveries = webhookEngine.allDeliveries().filter((d) => d.merchantId === merchantId);
        return NextResponse.json({ endpoints, deliveries });
      }
      default:
        return NextResponse.json({ error: 'unknown_action', action }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: 'server_error', message: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
