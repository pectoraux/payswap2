import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only waitlist endpoints.
 *
 * GET  /api/admin/waitlist            — list entries (filterable by status,
 *                                       accountType, country, plus text q)
 * PATCH /api/admin/waitlist           — approve or reject an entry
 *      body: { id, action: 'APPROVED' | 'REJECTED' }
 *
 * On APPROVE:
 *   - generates a 16-char random password
 *   - creates a new User (status=ACTIVE, emailVerified=now) with that password
 *   - assigns the UserRole that matches the requested accountType
 *   - marks the waitlist entry as APPROVED + reviewedBy + reviewedAt
 *   - returns the plain password so the admin can paste it into the invite
 *     email (mocked — we don't actually send email here)
 *
 * Rejecting just flips the status to REJECTED.
 */
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) {
    return null;
  }
  return session;
}

/** GET /api/admin/waitlist — list waitlist entries. */
export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const accountType = url.searchParams.get('accountType') ?? undefined;
  const country = url.searchParams.get('country') ?? undefined;
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

  const where: any = {};
  if (status && status !== 'ALL') where.status = status;
  if (accountType && accountType !== 'ALL') where.accountType = accountType;
  if (country && country !== 'ALL') where.country = country;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { company: { contains: q } },
    ];
  }

  const entries = await db.waitlistEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return NextResponse.json({ entries, count: entries.length });
}

/** Generate a friendly random password: 8-char base32 + dash + 4-char base32. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I,O,0,1,L
  const pick = (n: number) =>
    Array.from({ length: n }, () =>
      alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
    ).join('');
  return `${pick(8)}-${pick(4)}`;
}

/** Map a waitlist accountType to a UserRole role. */
function accountTypeToRole(accountType: string | null): string {
  switch (accountType) {
    case 'MERCHANT':
      return 'MERCHANT';
    case 'LP':
      return 'LP';
    case 'DEVELOPER':
      return 'DEVELOPER';
    case 'CUSTOMER':
      return 'CUSTOMER';
    default:
      return 'CUSTOMER';
  }
}

/** PATCH /api/admin/waitlist — approve or reject a waitlist entry. */
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action.toUpperCase() : '';
  const reviewerId = (session.user as any)?.id as string | undefined;

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  if (!reviewerId) {
    return NextResponse.json({ error: 'No user id in session' }, { status: 400 });
  }
  if (action !== 'APPROVED' && action !== 'REJECTED') {
    return NextResponse.json(
      { error: "action must be 'APPROVED' or 'REJECTED'" },
      { status: 400 },
    );
  }

  // Fetch the entry first so we can use it for the approve flow.
  const entry = await db.waitlistEntry.findUnique({ where: { id } });
  if (!entry) {
    return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 });
  }

  // ── REJECT ──
  if (action === 'REJECTED') {
    const updated = await db.waitlistEntry.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
    return NextResponse.json({ entry: updated });
  }

  // ── APPROVE ──
  // 1. Generate a strong, friendly password.
  const plainPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  // 2. If a user with this email already exists, don't clobber their password.
  //    Just mark the waitlist entry as APPROVED and report "already exists".
  const existing = await db.user.findUnique({
    where: { email: entry.email },
    select: { id: true },
  });
  let userId: string;
  let alreadyExisted = false;
  if (existing) {
    userId = existing.id;
    alreadyExisted = true;
  } else {
    const newUser = await db.user.create({
      data: {
        email: entry.email,
        passwordHash,
        name: entry.name,
        phone: entry.phone ?? null,
        status: 'ACTIVE',
        emailVerified: new Date(),
      },
    });
    userId = newUser.id;

    // 3. Assign the matching UserRole.
    const role = accountTypeToRole(entry.accountType);
    // Avoid a duplicate UserRole row if one already exists for this user.
    const existingRole = await db.userRole.findFirst({
      where: { userId, role },
      select: { id: true },
    });
    if (!existingRole) {
      await db.userRole.create({
        data: { userId, role },
      });
    }
  }

  // 4. Mark the entry APPROVED + record reviewer + timestamp.
  const updated = await db.waitlistEntry.update({
    where: { id },
    data: {
      status: 'APPROVED',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({
    entry: updated,
    approve: {
      userId,
      email: entry.email,
      password: alreadyExisted ? null : plainPassword,
      alreadyExisted,
      role: accountTypeToRole(entry.accountType),
      // NOTE: in production we would send an invite email here. For now we
      // surface the password back to the admin so they can copy/paste it
      // into a manual email or DM.
      message: alreadyExisted
        ? 'A user with this email already existed. No new account created.'
        : `Account created. Temporary password: ${plainPassword}`,
    },
  });
}
