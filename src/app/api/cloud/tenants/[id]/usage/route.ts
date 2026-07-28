/**
 * GET /api/cloud/tenants/[id]/usage — get tenant usage + limit checks.
 *
 * Returns the tenant's current usage counters alongside per-resource limit
 * checks (so the UI can show "12 / 25 merchants" with a progress bar).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
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

  const resources = [
    'merchants',
    'lps',
    'transactionsThisMonth',
    'apiRequestsThisMinute',
    'storageGB',
    'extensionsInstalled',
  ] as const;

  const checks = await Promise.all(
    resources.map((r) => tenantManager.checkLimit(id, r)),
  );

  return NextResponse.json({
    usage: tenant.usage,
    limits: tenant.config.limits,
    checks: checks.map((c) => ({
      resource: c.resource,
      current: c.current,
      limit: c.limit,
      exceeded: c.exceeded,
      percent: c.limit > 0 ? Math.min(100, Math.round((c.current / c.limit) * 100)) : 0,
    })),
  });
}
