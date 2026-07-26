import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['owner', 'admin']);

const ALLOWED_COUNTRIES = new Set([
  'KE', 'GH', 'NG', 'UG', 'TZ', 'ZA', 'US', 'GB',
]);

const ALLOWED_CURRENCIES = new Set([
  'GHS', 'KES', 'NGN', 'UGX', 'TZS', 'ZAR', 'USD', 'GBP',
]);

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/organization/[id]
 *
 * Update an organization's editable profile fields. The caller must:
 *   - be authenticated
 *   - be a member of the organization with role `owner` or `admin`
 *
 * Body (all optional, only provided fields are touched):
 *   { name?, billingEmail?, country?, currency? }
 *
 * On success, the updated organization record is returned and an audit log
 * entry is written capturing the change.
 */
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Organization ID is required' },
      { status: 400 },
    );
  }

  // Verify membership + role.
  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: id, userId },
    },
    select: { id: true, role: true, status: true },
  });

  if (!membership || membership.status !== 'active') {
    return NextResponse.json(
      { error: 'You are not a member of this organization' },
      { status: 403 },
    );
  }
  if (!ALLOWED_ROLES.has(membership.role)) {
    return NextResponse.json(
      { error: 'Only owners and admins can edit organization details' },
      { status: 403 },
    );
  }

  // Parse the body.
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, string | null> = {};
  if (typeof body.name === 'string' && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 120);
  }
  if (body.billingEmail === null) {
    patch.billingEmail = null;
  } else if (typeof body.billingEmail === 'string') {
    const trimmed = body.billingEmail.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: 'billingEmail is not a valid email address' },
        { status: 400 },
      );
    }
    patch.billingEmail = trimmed ? trimmed.toLowerCase().slice(0, 160) : null;
  }
  if (typeof body.country === 'string') {
    const upper = body.country.trim().toUpperCase();
    if (!ALLOWED_COUNTRIES.has(upper)) {
      return NextResponse.json(
        { error: `country must be one of: ${[...ALLOWED_COUNTRIES].join(', ')}` },
        { status: 400 },
      );
    }
    patch.country = upper;
  }
  if (typeof body.currency === 'string') {
    const upper = body.currency.trim().toUpperCase();
    if (!ALLOWED_CURRENCIES.has(upper)) {
      return NextResponse.json(
        { error: `currency must be one of: ${[...ALLOWED_CURRENCIES].join(', ')}` },
        { status: 400 },
      );
    }
    patch.currency = upper;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Provide at least one of: name, billingEmail, country, currency' },
      { status: 400 },
    );
  }

  const updated = await db.organization.update({
    where: { id },
    data: patch,
  });

  // Best-effort audit log. Failures here should not break the response.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'ORGANIZATION.UPDATE',
        resourceType: 'Organization',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({ fields: Object.keys(patch) }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ organization: updated });
}

/**
 * GET /api/organization/[id]
 *
 * Returns the public profile of an organization the caller is a member of.
 */
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Organization ID is required' },
      { status: 400 },
    );
  }

  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: id, userId },
    },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json(
      { error: 'You are not a member of this organization' },
      { status: 403 },
    );
  }

  const organization = await db.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      country: true,
      currency: true,
      plan: true,
      billingEmail: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!organization) {
    return NextResponse.json(
      { error: 'Organization not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({ organization });
}
