import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/ops/replay
 *
 * Replay a slice of the EventRecord table. Body:
 *   { fromSeq: number, toSeq: number }
 *
 * Walks every event in [fromSeq, toSeq] (inclusive), "applies" each one
 * (here: a simulated no-op that just counts the replay), and returns the
 * number of events replayed and any per-event errors. Records the replay
 * itself as an AuditLog entry so the run is traceable.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fromSeq =
    typeof body?.fromSeq === 'number' && Number.isFinite(body.fromSeq)
      ? Math.max(0, Math.floor(body.fromSeq))
      : null;
  const toSeq =
    typeof body?.toSeq === 'number' && Number.isFinite(body.toSeq)
      ? Math.max(0, Math.floor(body.toSeq))
      : null;

  if (fromSeq === null || toSeq === null) {
    return NextResponse.json(
      { error: 'fromSeq and toSeq must be integers' },
      { status: 400 },
    );
  }
  if (fromSeq > toSeq) {
    return NextResponse.json(
      { error: 'fromSeq must be <= toSeq' },
      { status: 400 },
    );
  }

  const events = await db.eventRecord.findMany({
    where: {
      seq: { gte: fromSeq, lte: toSeq },
    },
    orderBy: { seq: 'asc' },
    take: 1000,
  });

  const errors: Array<{ seq: number; eventId: string; error: string }> = [];

  // The actual replay is application-defined — for the ops dashboard we just
  // validate that each event's payload parses as JSON, mirroring how a real
  // projection-rebuild loop would walk the stream and surface bad rows.
  for (const evt of events) {
    if (typeof evt.payload === 'string' && evt.payload.length > 0) {
      try {
        JSON.parse(evt.payload);
      } catch (e) {
        errors.push({
          seq: evt.seq,
          eventId: evt.eventId,
          error: e instanceof Error ? e.message : 'Invalid JSON payload',
        });
      }
    }
  }

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'OPS.EVENT_REPLAY',
        resourceType: 'EventRecord',
        resourceId: null,
        result: errors.length === 0 ? 'SUCCESS' : 'PARTIAL',
        details: JSON.stringify({
          fromSeq,
          toSeq,
          replayed: events.length,
          errors: errors.length,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    replayed: events.length,
    errors,
    fromSeq,
    toSeq,
  });
}
