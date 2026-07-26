import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER', 'SUPPORT']);
const ALLOWED_STATUS = new Set(['ACTIVE', 'SUSPENDED', 'PENDING']);
const ACTIONS = new Set(['ACCEPT', 'DECLINE', 'SUSPEND', 'REMOVE', 'ROLE', 'REACTIVATE']);

/** Map a guard error to the appropriate HTTP response. */
function guardErrorResponse(code: string) {
  if (code === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * PATCH /api/team/[id]
 *
 * Update a single team member. The body selects one of the following modes:
 *
 *   { action: 'ACCEPT' }      -> status = ACTIVE, joinedAt = now
 *   { action: 'DECLINE' }     -> delete the team member
 *   { action: 'SUSPEND' }     -> status = SUSPENDED
 *   { action: 'REACTIVATE' }  -> status = ACTIVE (preserve joinedAt)
 *   { action: 'REMOVE' }      -> delete the team member
 *   { action: 'ROLE', role }  -> update the role (role must be valid)
 *   { role: 'ADMIN' }         -> convenience: update the role directly
 *   { status: 'SUSPENDED' }   -> convenience: update the status directly
 *
 * In every case the team member must belong to the authenticated merchant.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let merchantId: string;
  let session: any;
  try {
    const ctx = await requireMerchant();
    merchantId = ctx.merchantId;
    session = ctx.session;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'UNAUTHORIZED';
    return guardErrorResponse(code);
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Team member ID is required' }, { status: 400 });
  }

  const member = await db.teamMember.findUnique({ where: { id } });
  if (!member) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }
  if (member.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Team member does not belong to this merchant' },
      { status: 403 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional for some actions — empty is fine.
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';

  // -- Action-based updates ----------------------------------------------
  if (action) {
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Unknown action '${action}'` },
        { status: 400 },
      );
    }

    if (action === 'DECLINE' || action === 'REMOVE') {
      await db.teamMember.delete({ where: { id } });
      try {
        await db.auditLog.create({
          data: {
            userId: (session?.user as any)?.id ?? null,
            action: action === 'DECLINE' ? 'TEAM.DECLINE' : 'TEAM.REMOVE',
            resourceType: 'TeamMember',
            resourceId: id,
            result: 'SUCCESS',
            details: JSON.stringify({ email: member.email }),
          },
        });
      } catch {
        // best-effort
      }
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (action === 'ACCEPT') {
      const updated = await db.teamMember.update({
        where: { id },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
      return NextResponse.json({ teamMember: updated });
    }

    if (action === 'REACTIVATE') {
      const updated = await db.teamMember.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });
      return NextResponse.json({ teamMember: updated });
    }

    if (action === 'SUSPEND') {
      const updated = await db.teamMember.update({
        where: { id },
        data: { status: 'SUSPENDED' },
      });
      return NextResponse.json({ teamMember: updated });
    }

    if (action === 'ROLE') {
      const role =
        typeof body?.role === 'string' ? body.role.trim().toUpperCase() : '';
      if (!ALLOWED_ROLES.has(role)) {
        return NextResponse.json(
          { error: 'Role must be one of ADMIN, DEVELOPER, ANALYST, VIEWER, SUPPORT' },
          { status: 400 },
        );
      }
      const updated = await db.teamMember.update({
        where: { id },
        data: { role },
      });
      return NextResponse.json({ teamMember: updated });
    }
  }

  // -- Convenience direct-field updates ------------------------------------
  if (typeof body?.role === 'string') {
    const role = body.role.trim().toUpperCase();
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: 'Role must be one of ADMIN, DEVELOPER, ANALYST, VIEWER, SUPPORT' },
        { status: 400 },
      );
    }
    const updated = await db.teamMember.update({
      where: { id },
      data: { role },
    });
    return NextResponse.json({ teamMember: updated });
  }

  if (typeof body?.status === 'string') {
    const status = body.status.trim().toUpperCase();
    if (!ALLOWED_STATUS.has(status)) {
      return NextResponse.json(
        { error: 'Status must be one of ACTIVE, SUSPENDED, PENDING' },
        { status: 400 },
      );
    }
    const patch: { status: string; joinedAt?: Date } = { status };
    // First time we flip to ACTIVE, stamp joinedAt if it was never set.
    if (status === 'ACTIVE' && !member.joinedAt) {
      patch.joinedAt = new Date();
    }
    const updated = await db.teamMember.update({
      where: { id },
      data: patch,
    });
    return NextResponse.json({ teamMember: updated });
  }

  return NextResponse.json(
    { error: 'Provide an action or a role/status to update' },
    { status: 400 },
  );
}

/**
 * DELETE /api/team/[id]
 *
 * Remove a team member outright. The member must belong to the authenticated
 * merchant.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let merchantId: string;
  let session: any;
  try {
    const ctx = await requireMerchant();
    merchantId = ctx.merchantId;
    session = ctx.session;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'UNAUTHORIZED';
    return guardErrorResponse(code);
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Team member ID is required' }, { status: 400 });
  }

  const member = await db.teamMember.findUnique({ where: { id } });
  if (!member) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }
  if (member.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Team member does not belong to this merchant' },
      { status: 403 },
    );
  }

  await db.teamMember.delete({ where: { id } });

  try {
    await db.auditLog.create({
      data: {
        userId: (session?.user as any)?.id ?? null,
        action: 'TEAM.REMOVE',
        resourceType: 'TeamMember',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({ email: member.email }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ ok: true, deleted: true });
}
