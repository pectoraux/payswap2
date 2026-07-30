/**
 * EKG — Tracing (OpenTelemetry-style spans).
 *
 * Every resolve() call produces a trace with nested spans:
 *   resolve(goal)
 *     ├─ planner.span (prove goal)
 *     │   ├─ capability.span (find providers)
 *     │   │   ├─ provider.span (score provider)
 *     │   │   └─ provider.span (score provider)
 *     │   ├─ capability.span (recurse on requires)
 *     │   └─ planner.span (verify)
 *     └─ settlement.span (execute)
 *
 * One click answers: "Why did this proof cost $12.18?"
 *
 * Spans are persisted to PostgreSQL (TraceSpan table) and can be queried
 * by traceId for full execution timeline visualization.
 */

import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: 'planner' | 'capability' | 'provider' | 'settlement' | 'verification' | 'simulation';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
  errorMessage?: string;
}

export interface Trace {
  id: string;
  spans: Span[];
  startTime: number;
  endTime?: number;
  durationMs?: number;
}

/**
 * Create a new trace. A trace groups all spans for a single resolve() call.
 */
export function startTrace(name: string): { traceId: string; rootSpan: SpanHandle } {
  const traceId = uid('trace');
  const rootSpan = startSpan(traceId, undefined, name, 'planner');
  return { traceId, rootSpan };
}

/**
 * Start a span within a trace.
 */
export function startSpan(
  traceId: string,
  parentSpanId: string | undefined,
  name: string,
  kind: Span['kind'],
  attributes: Record<string, unknown> = {},
): SpanHandle {
  const spanId = uid('span');
  const startTime = Date.now();
  const span: Span = {
    id: spanId, traceId, parentSpanId, name, kind,
    startTime, attributes, status: 'ok',
  };
  // Persist asynchronously (don't block the planner)
  db.traceSpan.create({
    data: {
      id: spanId, traceId, parentSpanId: parentSpanId ?? null,
      name, kind, startTime: new Date(startTime),
      attributes: JSON.stringify(attributes),
    },
  }).catch(() => { /* best-effort */ });
  return {
    spanId,
    traceId,
    span,
    end(status: 'ok' | 'error' = 'ok', errorMessage?: string, extraAttrs?: Record<string, unknown>) {
      const endTime = Date.now();
      span.endTime = endTime;
      span.durationMs = endTime - startTime;
      span.status = status;
      span.errorMessage = errorMessage;
      if (extraAttrs) span.attributes = { ...span.attributes, ...extraAttrs };
      // Persist the end
      db.traceSpan.update({
        where: { id: spanId },
        data: {
          endTime: new Date(endTime),
          durationMs: span.durationMs,
          status,
          errorMessage: errorMessage ?? null,
          attributes: JSON.stringify(span.attributes),
        },
      }).catch(() => { /* best-effort */ });
    },
    child(name: string, kind: Span['kind'], attrs?: Record<string, unknown>) {
      return startSpan(traceId, spanId, name, kind, attrs);
    },
  };
}

export interface SpanHandle {
  spanId: string;
  traceId: string;
  span: Span;
  end(status?: 'ok' | 'error', errorMessage?: string, extraAttrs?: Record<string, unknown>): void;
  child(name: string, kind: Span['kind'], attrs?: Record<string, unknown>): SpanHandle;
}

/**
 * Get all spans for a trace, ordered by start time.
 * Used to render the execution timeline.
 */
export async function getTrace(traceId: string): Promise<Trace | null> {
  const rows = await db.traceSpan.findMany({
    where: { traceId },
    orderBy: { startTime: 'asc' },
  });
  if (rows.length === 0) return null;
  const spans: Span[] = rows.map((r) => ({
    id: r.id, traceId: r.traceId, parentSpanId: r.parentSpanId ?? undefined,
    name: r.name, kind: r.kind as Span['kind'],
    startTime: r.startTime.getTime(),
    endTime: r.endTime?.getTime(),
    durationMs: r.durationMs ?? undefined,
    attributes: r.attributes ? JSON.parse(r.attributes) : {},
    status: r.status as 'ok' | 'error',
    errorMessage: r.errorMessage ?? undefined,
  }));
  const start = spans[0].startTime;
  const end = spans.reduce((max, s) => Math.max(max, s.endTime ?? s.startTime), 0);
  return {
    id: traceId,
    spans,
    startTime: start,
    endTime: end > start ? end : undefined,
    durationMs: end > start ? end - start : undefined,
  };
}

/**
 * List recent traces.
 */
export async function listTraces(limit = 20): Promise<Array<{ traceId: string; spanCount: number; startTime: number; durationMs?: number; status: string }>> {
  const rows = await db.traceSpan.findMany({
    take: limit * 10, // get enough rows to group by traceId
    orderBy: { startTime: 'desc' },
  });
  const byTrace = new Map<string, { traceId: string; spanCount: number; startTime: number; endTime: number; hasError: boolean }>();
  for (const r of rows) {
    const tid = r.traceId;
    if (!byTrace.has(tid)) {
      byTrace.set(tid, { traceId: tid, spanCount: 0, startTime: r.startTime.getTime(), endTime: r.startTime.getTime(), hasError: false });
    }
    const t = byTrace.get(tid)!;
    t.spanCount++;
    t.endTime = Math.max(t.endTime, r.endTime?.getTime() ?? r.startTime.getTime());
    if (r.status === 'error') t.hasError = true;
  }
  return Array.from(byTrace.values())
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit)
    .map((t) => ({
      traceId: t.traceId,
      spanCount: t.spanCount,
      startTime: t.startTime,
      durationMs: t.endTime > t.startTime ? t.endTime - t.startTime : undefined,
      status: t.hasError ? 'error' : 'ok',
    }));
}
