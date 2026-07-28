/**
 * GET /api/cloud/tenants/[id]/billing — get billing history + current invoice.
 *
 * Returns: { subscription, invoices, currentInvoice, usageHistory }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const isMember = tenant.members.some((m) => m.userId === userId);
  if (!isAdmin && !isMember) return forbidden();

  const url = new URL(req.url);
  const monthsParam = url.searchParams.get('months');
  const months = monthsParam ? Math.max(1, Math.min(24, parseInt(monthsParam, 10) || 6)) : 6;

  const [subscription, invoices, currentInvoice, usageHistory] = await Promise.all([
    cloudEngine.billing.getSubscription(id),
    cloudEngine.billing.listInvoices(id),
    cloudEngine.billing.generateInvoice(id),
    cloudEngine.billing.getUsageHistory(id, months),
  ]);

  return NextResponse.json({
    subscription,
    invoices,
    currentInvoice,
    usageHistory,
  });
}
