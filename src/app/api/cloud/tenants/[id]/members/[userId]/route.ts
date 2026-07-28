/**
 * PATCH  /api/cloud/tenants/[id]/members/[userId] — update member role.
 * DELETE /api/cloud/tenants/[id]/members/[userId] — remove member.
 *
 * PATCH body: { role: CloudTenantRole }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { tenantManager } from '@/cloud';
import type { CloudTenantRole } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: CloudTenantRole[] = ['owner', 'admin', 'developer', 'operator', 'viewer'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const actorId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id, userId } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const member = tenant.members.find((m) => m.userId === actorId);
  const canManage = isAdmin || (member && (member.role === 'owner' || member.role === 'admin'));
  if (!canManage) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const role = body?.role as CloudTenantRole;
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }

  // Prevent demoting the last owner.
  const targetMember = tenant.members.find((m) => m.userId === userId);
  if (targetMember?.role === 'owner' && role !== 'owner') {
    const owners = tenant.members.filter((m) => m.role === 'owner');
    if (owners.length <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last owner — assign a new owner first' },
        { status: 400 },
      );
    }
  }

  await tenantManager.updateMemberRole(id, userId, role, actorId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const actorId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id, userId } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const member = tenant.members.find((m) => m.userId === actorId);
  const canManage = isAdmin || (member && (member.role === 'owner' || member.role === 'admin'));
  if (!canManage) return forbidden();

  // Prevent removing the last owner.
  const targetMember = tenant.members.find((m) => m.userId === userId);
  if (targetMember?.role === 'owner') {
    const owners = tenant.members.filter((m) => m.role === 'owner');
    if (owners.length <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last owner — assign a new owner first' },
        { status: 400 },
      );
    }
  }

  await tenantManager.removeMember(id, userId, actorId);
  return NextResponse.json({ ok: true });
}
