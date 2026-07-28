/**
 * POST   /api/cloud/tenants/[id]/members        — add member (invite).
 * GET    /api/cloud/tenants/[id]/members        — list members.
 * PATCH  /api/cloud/tenants/[id]/members/[userId] — update member role.
 * DELETE /api/cloud/tenants/[id]/members/[userId] — remove member.
 *
 * POST body:  { userId: string, role: CloudTenantRole }
 * PATCH body: { role: CloudTenantRole }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { tenantManager } from '@/cloud';
import type { CloudTenantRole } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: CloudTenantRole[] = ['owner', 'admin', 'developer', 'operator', 'viewer'];

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

  return NextResponse.json({ members: tenant.members });
}

export async function POST(
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

  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin || (member && (member.role === 'owner' || member.role === 'admin'));
  if (!canManage) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const targetUserId = (body?.userId as string)?.trim();
  const role = body?.role as CloudTenantRole;

  if (!targetUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }

  const added = await tenantManager.addMember(id, targetUserId, role, userId);
  return NextResponse.json({ member: added }, { status: 201 });
}
