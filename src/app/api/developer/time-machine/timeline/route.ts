/**
 * GET /api/developer/time-machine/timeline
 *
 * Returns timeline metadata so the UI can build a slider:
 *   - First event seq + timestamp
 *   - Last event seq + timestamp
 *   - Total event count
 *   - Event types with counts (top N)
 *
 * Reads from runtime.eventStore (frozen kernel, read-only).
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    const totalEvents = runtime.eventStore.size();
    if (totalEvents === 0) {
      return NextResponse.json({
        ok: true,
        totalEvents: 0,
        firstSeq: 0,
        lastSeq: 0,
        firstTs: 0,
        lastTs: 0,
        eventTypes: [],
        generatedAt: Date.now(),
      });
    }

    // Fetch the first event and the last event in two reads. Each read is O(limit)
    // on an in-memory store so this is cheap.
    const firstBatch = await runtime.eventStore.readAll(0, 1);
    const lastBatch = await runtime.eventStore.readAll(totalEvents - 1, 1);
    const firstEvent = firstBatch[0];
    const lastEvent = lastBatch[0];

    // For event type counts: scan the whole log once. For very large logs this
    // could be paginated, but the dev event store is small (in-memory + live
    // environment reset on each dev-server restart). We cap at 10k events to
    // stay within memory budget.
    const SCAN_CAP = 10_000;
    const eventTypes = new Map<string, number>();
    let cursor = 0;
    while (cursor < Math.min(totalEvents, SCAN_CAP)) {
      const batch = await runtime.eventStore.readAll(cursor, 500);
      if (batch.length === 0) break;
      for (const ev of batch) {
        eventTypes.set(ev.type, (eventTypes.get(ev.type) ?? 0) + 1);
      }
      cursor += batch.length;
    }

    // Sort by count descending.
    const eventTypesArr = [...eventTypes.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      totalEvents,
      scannedEvents: Math.min(totalEvents, SCAN_CAP),
      firstSeq: firstEvent?.globalPosition ?? 0,
      lastSeq: lastEvent?.globalPosition ?? 0,
      firstTs: firstEvent?.metadata.timestamp ?? 0,
      lastTs: lastEvent?.metadata.timestamp ?? 0,
      eventTypes: eventTypesArr,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error('[api/developer/time-machine/timeline GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
