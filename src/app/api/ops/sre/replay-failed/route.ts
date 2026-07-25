import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/ops/sre/replay-failed
 *
 * Counts failed webhook deliveries (status='FAILED') and "queues" them for
 * replay. In this sandbox we don't actually re-send — we mark them as
 * PENDING again so the delivery loop will pick them up, and we record an
 * AuditLog entry. The response returns the count so the UI can toast it.
 *
 * Requires OPERATIONS or ADMIN role.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  const failed = await db.webhookDelivery.findMany({
    where: { status: 'FAILED' },
    take: 500,
    select: { id: true },
  });

  let replayed = 0;
  if (failed.length > 0) {
    const result = await db.webhookDelivery.updateMany({
      where: { id: { in: failed.map((f) => f.id) } },
      data: {
        status: 'PENDING',
        nextRetryAt: new Date(),
      },
    });
    replayed = result.count;
  }

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'SRE.REPLAY_FAILED_WEBHOOKS',
        resourceType: 'WebhookDelivery',
        resourceId: null,
        result: 'SUCCESS',
        details: JSON.stringify({
          failedCount: failed.length,
          replayed,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    queued: replayed,
    failedCount: failed.length,
  });
}
