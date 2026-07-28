import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { sarManager, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/trust/sars/[id]/file
 *
 * File a draft SAR with the regulator. Body (optional): { filedBy?: string }
 *
 * The SAR is mirrored to the `SAR` Prisma model so existing exports / dashboards
 * keep working.
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
  const existing = sarManager.get(id);
  if (!existing) {
    return NextResponse.json({ error: 'SAR not found' }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const filedBy =
    typeof body?.filedBy === 'string' && body.filedBy.trim()
      ? body.filedBy.trim()
      : userId ?? 'unknown';

  const sar = await sarManager.fileSAR(id, filedBy);
  if (!sar) {
    return NextResponse.json({ error: 'SAR not found' }, { status: 404 });
  }

  // Mirror to SAR Prisma model (best-effort).
  try {
    await db.sAR.upsert({
      where: { id },
      create: {
        id,
        filedBy,
        narrative: sar.narrative,
        amount: sar.amount,
        entities: JSON.stringify([{ subject: sar.subject }]),
        regulatoryRef: sar.regulatorReference ?? null,
        status: 'FILED',
        filedAt: sar.filedAt ? new Date(sar.filedAt) : new Date(),
      },
      update: {
        status: 'FILED',
        filedBy,
        regulatoryRef: sar.regulatorReference ?? null,
        filedAt: sar.filedAt ? new Date(sar.filedAt) : new Date(),
      },
    });
  } catch {
    // best-effort
  }

  await complianceAuditTrail.record({
    action: 'trust.sar.file',
    actorId: filedBy,
    entityType: 'sar',
    entityId: id,
    details: {
      alertIds: sar.alertIds,
      amount: sar.amount,
      currency: sar.currency,
      regulatorReference: sar.regulatorReference,
    },
    result: 'success',
  });

  return NextResponse.json({ sar });
}
