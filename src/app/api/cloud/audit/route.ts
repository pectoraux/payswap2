/**
 * GET /api/cloud/audit — query the cloud audit log (admin: all tenants;
 * members: their own tenant).
 *
 * Query params:
 *   ?tenantId=<id>     restrict to a tenant (admins can query any)
 *   ?action=<string>   filter by action (e.g. 'tenant.created')
 *   ?actorId=<id>      filter by actor
 *   ?resourceType=<t>  filter by resource type
 *   ?limit=<n>         max entries (default 100, max 500)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudAudit, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const action = url.searchParams.get('action') ?? undefined;
  const actorId = url.searchParams.get('actorId') ?? undefined;
  const resourceType = url.searchParams.get('resourceType') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100)) : 100;

  // If a specific tenantId is requested, authorize membership (unless admin).
  if (tenantId) {
    if (!isAdmin) {
      const tenant = await tenantManager.get(tenantId);
      if (!tenant) return forbidden();
      const isMember = tenant.members.some((m) => m.userId === userId);
      if (!isMember) return forbidden();
    }
    const entries = await cloudAudit.query(tenantId, { action, actorId, resourceType });
    return NextResponse.json({
      count: Math.min(entries.length, limit),
      entries: entries.slice(0, limit),
    });
  }

  // No tenantId → admin-only cross-tenant query.
  if (!isAdmin) return forbidden();
  const entries = await cloudAudit.queryAll({ action, actorId, resourceType });
  return NextResponse.json({
    count: Math.min(entries.length, limit),
    entries: entries.slice(0, limit),
  });
}
