/**
 * GET /api/developer/inspectors/events
 *
 * Reads the runtime event store directly. Supports query params:
 *   - type: filter by event type (substring match, e.g. "payment.", "treasury.")
 *   - aggregateId: filter by stream ID (substring match)
 *   - limit: page size (default 100, max 1000)
 *   - offset: pagination offset (default 0)
 *   - afterSeq: only events with globalPosition > afterSeq
 *
 * The runtime is a frozen kernel — we only READ from it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';
import type { StoredEvent } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EventRow {
  seq: number;
  id: string;
  type: string;
  streamId: string;
  streamType: string;
  version: number;
  kind: 'domain' | 'runtime';
  timestamp: number;
  actor: string;
  environment: string;
  correlationId: string;
  intentId: string;
  payload: Record<string, unknown>;
}

const MAX_LIMIT = 1000;

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const typeFilter = sp.get('type')?.trim() || '';
  const aggregateFilter = sp.get('aggregateId')?.trim() || '';
  const afterSeqRaw = Number(sp.get('afterSeq') ?? '0');
  const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, afterSeqRaw) : 0;
  const limitRaw = Number(sp.get('limit') ?? '100');
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 100;
  const offsetRaw = Number(sp.get('offset') ?? '0');
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  try {
    // Read the global log from `afterSeq`. The in-memory store slices the
    // global array; we pull up to MAX_LIMIT and then apply filters + pagination.
    const fromPosition = afterSeq;
    const fetched = await payswapRuntime.eventStore.readAll(fromPosition, MAX_LIMIT);

    let filtered: StoredEvent[] = fetched;
    if (typeFilter) {
      // Support both prefix (e.g. "payment.") and exact match.
      filtered = filtered.filter(
        (e) => e.type === typeFilter || e.type.startsWith(typeFilter),
      );
    }
    if (aggregateFilter) {
      filtered = filtered.filter((e) =>
        e.streamId.includes(aggregateFilter) ||
        e.streamType.includes(aggregateFilter),
      );
    }

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);

    const rows: EventRow[] = paged.map((e) => ({
      seq: e.globalPosition,
      id: e.id,
      type: e.type,
      streamId: e.streamId,
      streamType: e.streamType,
      version: e.version,
      kind: e.kind,
      timestamp: e.metadata.timestamp,
      actor: e.metadata.actor,
      environment: e.metadata.environment,
      correlationId: e.metadata.correlationId,
      intentId: e.metadata.intentId,
      payload: e.payload,
    }));

    // Distinct event types (for the filter dropdown).
    const types = Array.from(new Set(fetched.map((e) => e.type))).sort();

    return NextResponse.json({
      ok: true,
      events: rows,
      total,
      offset,
      limit,
      afterSeq,
      totalInStore: payswapRuntime.eventStore.size(),
      types,
    });
  } catch (err) {
    console.error('[api/developer/inspectors/events] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
