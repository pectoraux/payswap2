import { NextRequest, NextResponse } from 'next/server';
import { billing } from '@/extension-ecosystem';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const tenantId = sp.get('tenantId') ?? 'default';
  const view = sp.get('view') ?? 'subscriptions';
  if (view === 'invoices') return NextResponse.json({ invoices: billing.listInvoices(tenantId) });
  return NextResponse.json({ subscriptions: billing.listSubscriptions(tenantId) });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = body.action as string;
  if (action === 'subscribe') {
    const sub = billing.subscribe(body.extensionId as string, body.tenantId as string, body.billingModel as 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION' | 'USAGE_BASED' | 'REVENUE_SHARE' | 'ENTERPRISE', body.price as number, body.currency as string, body.interval as 'MONTHLY' | 'YEARLY', body.trialDays as number);
    return NextResponse.json({ subscription: sub, message: `✓ Subscribed (${sub.status})` }, { status: 201 });
  }
  if (action === 'usage') {
    const record = billing.recordUsage(body.subscriptionId as string, body.metric as string, body.quantity as number, body.unitPrice as number);
    return NextResponse.json({ record });
  }
  if (action === 'invoice') {
    const invoice = billing.generateInvoice(body.subscriptionId as string);
    return NextResponse.json({ invoice, message: `✓ Invoice generated: $${invoice.amount} ${invoice.currency}` }, { status: 201 });
  }
  if (action === 'pay') {
    const invoice = billing.payInvoice(body.invoiceId as string);
    return NextResponse.json({ invoice, message: invoice?.status === 'PAID' ? '✓ Invoice paid' : '✗ Payment failed' });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
