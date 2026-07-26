import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER', 'SUPPORT']);

/** Map a guard error to the appropriate HTTP response. */
function guardErrorResponse(code: string) {
  if (code === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST /api/team/invite
 *
 * Invite a new member to the authenticated merchant's team. Creates a
 * `TeamMember` record in the PENDING state. If the supplied email matches an
 * existing User, the record is linked to that user via `userId`.
 *
 * Body:
 *   { email: string, role: 'ADMIN' | 'DEVELOPER' | 'ANALYST' | 'VIEWER' | 'SUPPORT' }
 */
export async function POST(req: NextRequest) {
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const role =
    typeof body?.role === 'string' ? body.role.trim().toUpperCase() : '';
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      { error: 'Role must be one of ADMIN, DEVELOPER, ANALYST, VIEWER, SUPPORT' },
      { status: 400 },
    );
  }

  // Prevent duplicate invites for the same merchant + email.
  const existing = await db.teamMember.findUnique({
    where: { merchantId_email: { merchantId, email } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'That email has already been invited to your team' },
      { status: 409 },
    );
  }

  // Best-effort link to an existing user account.
  const linkedUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  const member = await db.teamMember.create({
    data: {
      merchantId,
      email,
      role,
      status: 'PENDING',
      userId: linkedUser?.id ?? null,
    },
  });

  // Record an audit entry so the invitation is traceable.
  try {
    await db.auditLog.create({
      data: {
        userId: (session?.user as any)?.id ?? null,
        action: 'TEAM.INVITE',
        resourceType: 'TeamMember',
        resourceId: member.id,
        result: 'SUCCESS',
        details: JSON.stringify({ email, role }),
      },
    });
  } catch {
    // Audit log failures must never block the invitation itself.
  }

  return NextResponse.json({ teamMember: member }, { status: 201 });
}
