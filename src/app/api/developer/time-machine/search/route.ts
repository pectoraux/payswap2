/**
 * GET /api/developer/time-machine/search?q=QUERY&limit=N
 *
 * Searches the event log for events matching a query. Matches against:
 *   - event type (substring, case-insensitive)
 *   - streamId (substring, case-insensitive)
 *   - seq number (exact match if query is numeric)
 *
 * Returns up to `limit` (default 50) matching events, most recent first.
 * Used by the Time Machine UI's "Jump to event" feature.
 *
 * Also accepts `?ts=UNIX_MS` to find the event nearest to a given timestamp
 * (for the date/time picker).
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const tsRaw = url.searchParams.get('ts');
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const SCAN_CAP = 10_000;

  try {
    const totalEvents = runtime.eventStore.size();
    if (totalEvents === 0) {
      return NextResponse.json({ ok: true, results: [], nearest: null, totalEvents: 0 });
    }

    // Date/time picker mode: find the event nearest to the given timestamp.
    if (tsRaw) {
      const target = Number(tsRaw);
      if (!Number.isFinite(target)) {
        return NextResponse.json({ ok: false, error: 'Invalid ts' }, { status: 400 });
      }
      let best: { seq: number; ts: number; type: string } | null = null;
      let cursor = 0;
      while (cursor < Math.min(totalEvents, SCAN_CAP)) {
        const take = Math.min(500, totalEvents - cursor);
        const batch = await runtime.eventStore.readAll(cursor, take);
        if (batch.length === 0) break;
        for (const ev of batch) {
          if (!best || Math.abs(ev.metadata.timestamp - target) < Math.abs(best.ts - target)) {
            best = { seq: ev.globalPosition, ts: ev.metadata.timestamp, type: ev.type };
          }
        }
        cursor += batch.length;
      }
      return NextResponse.json({ ok: true, results: [], nearest: best, totalEvents });
    }

    if (!q) {
      return NextResponse.json({ ok: true, results: [], nearest: null, totalEvents });
    }

    const isNumericSeq = /^\d+$/.test(q);
    const seqMatch = isNumericSeq ? parseInt(q, 10) : -1;

    const results: { seq: number; ts: number; type: string; streamId: string }[] = [];
    let cursor = 0;
    while (cursor < Math.min(totalEvents, SCAN_CAP)) {
      const take = Math.min(500, totalEvents - cursor);
      const batch = await runtime.eventStore.readAll(cursor, take);
      if (batch.length === 0) break;
      for (const ev of batch) {
        const matches =
          (isNumericSeq && ev.globalPosition === seqMatch) ||
          ev.type.toLowerCase().includes(q) ||
          ev.streamId.toLowerCase().includes(q);
        if (matches) {
          results.push({
            seq: ev.globalPosition,
            ts: ev.metadata.timestamp,
            type: ev.type,
            streamId: ev.streamId,
          });
          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
      cursor += batch.length;
    }

    // Sort by seq descending (most recent first).
    results.sort((a, b) => b.seq - a.seq);

    return NextResponse.json({ ok: true, results, nearest: null, totalEvents });
  } catch (err) {
    console.error('[api/developer/time-machine/search GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
