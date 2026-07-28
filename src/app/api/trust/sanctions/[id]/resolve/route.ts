import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sanctionsScreener, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const ALLOWED = new Set(['true_positive', 'false_positive', 'review']);

/**
 * POST /api/trust/sanctions/[id]/resolve
 *
 * Body: { status: 'true_positive' | 'false_positive' | 'review',
 *         notes?: string }
 *
 * Mark a sanctions screening as resolved.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  const { id } = await params;
  const existing = sanctionsScreener.get(id);
  if (!existing) {
    return NextResponse.json(
      { error: 'Sanctions screening not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = typeof body?.status === 'string' ? body.status.toLowerCase() : '';
  if (!ALLOWED.has(status)) {
    return NextResponse.json(
      {
        error: "status must be 'true_positive', 'false_positive', or 'review'",
      },
      { status: 400 },
    );
  }
  const notes =
    typeof body?.notes === 'string' && body.notes.trim()
      ? body.notes.trim()
      : undefined;

  const updated = sanctionsScreener.resolve(
    id,
    status as any,
    userId ?? 'unknown',
    notes,
  );

  await complianceAuditTrail.record({
    action: 'trust.sanctions.resolve',
    actorId: userId ?? 'unknown',
    entityType: 'sanctions_screening',
    entityId: id,
    details: {
      previousStatus: existing.status,
      nextStatus: status,
      matchScore: existing.matchScore,
      matchedList: existing.matchedList,
      matchedName: existing.matchedName,
      notes,
    },
    result: 'success',
  });

  return NextResponse.json({ screening: updated });
}
