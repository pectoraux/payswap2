import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/compliance/cases
 *
 * List all ComplianceReview cases (type = 'CASE'). Optional `?status=OPEN`
 * filter narrows by the case's current status.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status')?.trim().toUpperCase();

  const where: { type: string; status?: string } = { type: 'CASE' };
  if (statusFilter) where.status = statusFilter;

  const cases = await db.complianceReview.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({ cases });
}

/**
 * POST /api/compliance/cases
 *
 * Open a new compliance case. Body:
 *   { entityId, entityType, alertIds?, description? }
 *
 * Creates a ComplianceReview with type='CASE', status='OPEN' and records an
 * AuditLog entry so the case opening is traceable.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const entityId =
    typeof body?.entityId === 'string' ? body.entityId.trim() : '';
  const entityType =
    typeof body?.entityType === 'string' ? body.entityType.trim() : '';

  if (!entityId || !entityType) {
    return NextResponse.json(
      { error: 'entityId and entityType are required' },
      { status: 400 },
    );
  }

  const description =
    typeof body?.description === 'string' ? body.description.trim() : '';
  const alertIds: string[] = Array.isArray(body?.alertIds)
    ? body.alertIds.filter((a: unknown) => typeof a === 'string' && a.trim())
    : [];

  const data = JSON.stringify({
    description,
    alertIds,
    openedBy: userId ?? null,
  });

  const review = await db.complianceReview.create({
    data: {
      entityType,
      entityId,
      type: 'CASE',
      status: 'OPEN',
      data,
      notes: description || null,
      reviewerId: null,
      reviewedAt: null,
    },
  });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'COMPLIANCE.CASE_OPEN',
        resourceType: 'ComplianceReview',
        resourceId: review.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          entityType,
          entityId,
          alertIds,
          description,
        }),
      },
    });
  } catch {
    // best-effort — never block on audit
  }

  return NextResponse.json({ case: review }, { status: 201 });
}
