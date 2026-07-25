import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/ops/sre/clear-event-store
 *
 * Clears every row from the EventRecord table. Admin-only — operators cannot
 * wipe the event store. Records an AuditLog entry before wiping so the action
 * is traceable even after the table is empty.
 *
 * Returns the number of rows deleted.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ADMIN_ROLES.has(r))) {
    return NextResponse.json(
      {
        error:
          'Forbidden — clearing the event store requires the ADMIN or SUPER_ADMIN role',
      },
      { status: 403 },
    );
  }
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  // Snapshot the count first so we can return it + audit it.
  const countBefore = await db.eventRecord.count();

  if (countBefore > 0) {
    try {
      await db.auditLog.create({
        data: {
          userId: userId ?? null,
          action: 'SRE.CLEAR_EVENT_STORE',
          resourceType: 'EventRecord',
          resourceId: null,
          result: 'SUCCESS',
          details: JSON.stringify({
            rowsDeleted: countBefore,
            actorEmail: actorEmail ?? null,
          }),
        },
      });
    } catch {
      // best-effort
    }

    await db.eventRecord.deleteMany({});
  }

  return NextResponse.json({
    cleared: true,
    rowsDeleted: countBefore,
  });
}
