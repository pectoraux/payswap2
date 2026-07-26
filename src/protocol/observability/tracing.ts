/**
 * PaySwap Protocol — Observability — Distributed Tracing.
 *
 * OpenTelemetry-style distributed tracing, in-process. Provides:
 *
 *   - `Span`            : immutable record of a unit of work (traceId, spanId,
 *                         parentSpanId, name, kind, timing, attributes, events,
 *                         status).
 *   - `Tracer`          : creates spans; propagates context across `await`
 *                         boundaries via `AsyncLocalStorage` so a parent span
 *                         is automatically linked when a child span is started
 *                         inside a `withSpan(...)` block.
 *   - `TracerProvider`  : registry of named tracers + span processors.
 *   - `SpanProcessor`   : hook called on span start / end (batching, sampling).
 *   - `SpanExporter`    : sink for finished spans.
 *   - `InMemorySpanExporter` : keeps the last N spans, queryable by traceId,
 *                         name, or time range. Used by tests + dashboards.
 *
 * Predefined span names mirror PaySwap's critical paths:
 *   payment.create, payment.route, payment.settle, payout.process,
 *   ledger.post, connector.query, planner.solve, compliance.check
 *
 * Usage:
 *   const { span, end } = tracer.startSpan('payment.create', 'internal', { merchantId });
 *   ... do work ...
 *   end({ status: 'ok' });
 *
 *   // or:
 *   const result = tracer.withSpan('payment.route', () => routePayment(...));
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanKind = 'internal' | 'client' | 'server';
export type SpanStatus = 'ok' | 'error';

export interface SpanEvent {
  name: string;
  ts: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
}

/** Context propagated across async boundaries. */
export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface SpanEndOptions {
  status?: SpanStatus;
  attributes?: Record<string, unknown>;
}

/** A started span — the live handle callers use to add attributes / end it. */
export interface StartedSpan {
  span: Span;
  end: (opts?: SpanEndOptions) => Span;
  setAttribute: (key: string, value: unknown) => void;
  addEvent: (name: string, attributes?: Record<string, unknown>) => void;
  setStatus: (status: SpanStatus) => void;
}

/** Span processor — hooks called on span lifecycle events. */
export interface SpanProcessor {
  onStart(span: Span): void;
  onEnd(span: Span): void;
  flush?(): void;
}

/** Span exporter — sink for finished spans. */
export interface SpanExporter {
  export(spans: Span[]): void;
  flush?(): void;
}

// ---------------------------------------------------------------------------
// In-memory exporter
// ---------------------------------------------------------------------------

/**
 * In-memory span exporter. Keeps the last `maxSpans` spans and exposes query
 * helpers used by dashboards and tests.
 */
export class InMemorySpanExporter implements SpanExporter {
  private spans: Span[] = [];
  private readonly maxSpans: number;

  constructor(maxSpans = 10_000) {
    this.maxSpans = maxSpans;
  }

  export(spans: Span[]): void {
    this.spans.push(...spans);
    if (this.spans.length > this.maxSpans) {
      this.spans = this.spans.slice(-this.maxSpans);
    }
  }

  flush(): void {
    // no-op — in-memory
  }

  /** All spans (newest last). */
  all(): Span[] {
    return [...this.spans];
  }

  /** Total span count. */
  count(): number {
    return this.spans.length;
  }

  /** Every span belonging to a trace. */
  getByTraceId(traceId: string): Span[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }

  /** Every span with a given name. */
  getByName(name: string): Span[] {
    return this.spans.filter((s) => s.name === name);
  }

  /** Spans whose `[startTime, endTime]` overlaps `[start, end]`. */
  getByTimeRange(start: number, end: number): Span[] {
    return this.spans.filter((s) => {
      const sEnd = s.endTime ?? s.startTime;
      return s.startTime <= end && sEnd >= start;
    });
  }

  /** Spans with status 'error'. */
  getErrors(): Span[] {
    return this.spans.filter((s) => s.status === 'error');
  }

  /** Average span duration for a given name (ms). */
  avgDuration(name?: string): number {
    const filtered = name ? this.spans.filter((s) => s.name === name) : this.spans;
    const done = filtered.filter((s) => s.endTime !== undefined);
    if (done.length === 0) return 0;
    const total = done.reduce((sum, s) => sum + ((s.endTime as number) - s.startTime), 0);
    return Math.round(total / done.length);
  }

  /** Clear all spans. */
  clear(): void {
    this.spans = [];
  }
}

// ---------------------------------------------------------------------------
// Span processors
// ---------------------------------------------------------------------------

/** Simple processor: forwards every finished span to the exporter immediately. */
export class SimpleSpanProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter) {}
  onStart(): void {}
  onEnd(span: Span): void {
    this.exporter.export([span]);
  }
  flush(): void {
    this.exporter.flush?.();
  }
}

/** Batch processor: buffers spans and flushes on size or interval. */
export class BatchSpanProcessor implements SpanProcessor {
  private buffer: Span[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;

  constructor(
    private readonly exporter: SpanExporter,
    opts: { maxBatchSize?: number; flushIntervalMs?: number } = {},
  ) {
    this.maxBatchSize = opts.maxBatchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
  }

  onStart(): void {}

  onEnd(span: Span): void {
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
      // Don't keep the Node.js event loop alive just for tracing.
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    this.exporter.export([...this.buffer]);
    this.buffer = [];
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

/**
 * Tracer — creates spans and propagates context across async boundaries via
 * `AsyncLocalStorage`. A span started inside a `withSpan(...)` callback
 * automatically links to the outer span as its parent.
 */
export class Tracer {
  private readonly processors: SpanProcessor[] = [];
  private readonly storage = new AsyncLocalStorage<SpanContext>();

  constructor(public readonly name: string) {}

  /** Attach a span processor (called for every span started by this tracer). */
  addProcessor(p: SpanProcessor): void {
    this.processors.push(p);
  }

  /** Current active context (traceId / spanId) — undefined outside a span. */
  currentContext(): SpanContext | undefined {
    return this.storage.getStore();
  }

  /** Run `fn` with a specific context active (advanced — prefer `withSpan`). */
  withContext<T>(ctx: SpanContext, fn: () => T): T {
    return this.storage.run(ctx, fn);
  }

  /**
   * Start a new span. If called inside an active `withSpan(...)` block, the
   * new span links to the active span as its parent (same traceId).
   */
  startSpan(
    name: string,
    kind: SpanKind = 'internal',
    attributes: Record<string, unknown> = {},
  ): StartedSpan {
    const parent = this.storage.getStore();
    const traceId = parent?.traceId ?? uid('trace');
    const spanId = uid('span');
    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parent?.spanId,
      name,
      kind,
      startTime: nowTs(),
      attributes: { ...attributes },
      events: [],
      status: 'ok',
    };
    for (const p of this.processors) {
      try {
        p.onStart(span);
      } catch {
        // processors must never break the traced code path
      }
    }

    const end = (opts: SpanEndOptions = {}): Span => {
      span.endTime = nowTs();
      if (opts.status) span.status = opts.status;
      if (opts.attributes) Object.assign(span.attributes, opts.attributes);
      for (const p of this.processors) {
        try {
          p.onEnd(span);
        } catch {
          // same — never break the caller
        }
      }
      try {
        eventEngine.emit(
          'trace.span',
          {
            traceId,
            spanId,
            parentSpanId: span.parentSpanId,
            name,
            kind,
            status: span.status,
            durationMs: span.endTime - span.startTime,
          },
          0,
        );
      } catch {
        // event bus must never break the caller
      }
      return span;
    };

    const setAttribute = (key: string, value: unknown): void => {
      span.attributes[key] = value;
    };
    const addEvent = (n: string, attrs?: Record<string, unknown>): void => {
      span.events.push({ name: n, ts: nowTs(), attributes: attrs });
    };
    const setStatus = (s: SpanStatus): void => {
      span.status = s;
    };

    return { span, end, setAttribute, addEvent, setStatus };
  }

  /**
   * Convenience wrapper: start a span, run `fn`, end the span, return result.
   * Handles sync, async (Promise), and throwing paths. If `fn` throws (or the
   * returned promise rejects), the span is marked `error` and the error is
   * re-thrown.
   */
  withSpan<T>(
    name: string,
    fn: () => T,
    opts: { kind?: SpanKind; attributes?: Record<string, unknown> } = {},
  ): T {
    const started = this.startSpan(name, opts.kind, opts.attributes);
    const ctx: SpanContext = {
      traceId: started.span.traceId,
      spanId: started.span.spanId,
    };
    try {
      const result = this.storage.run(ctx, fn);
      // Async path — end span after the promise settles.
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        return (result as Promise<unknown>)
          .then(
            (v) => {
              started.end({ status: 'ok' });
              return v;
            },
            (err: unknown) => {
              started.end({
                status: 'error',
                attributes: {
                  error: err instanceof Error ? err.message : String(err),
                },
              });
              throw err;
            },
          ) as T;
      }
      // Sync path.
      started.end({ status: 'ok' });
      return result;
    } catch (err) {
      started.end({
        status: 'error',
        attributes: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Tracer provider
// ---------------------------------------------------------------------------

/**
 * Tracer provider — owns named tracers and a global list of span processors.
 * Every tracer created via `getTracer(name)` is wired with all current (and
 * future) processors.
 */
export class TracerProvider {
  private readonly tracers = new Map<string, Tracer>();
  private readonly processors: SpanProcessor[] = [];
  private _defaultExporter?: InMemorySpanExporter;

  /** Attach a span processor — propagates to every existing + future tracer. */
  addSpanProcessor(p: SpanProcessor): void {
    this.processors.push(p);
    for (const t of this.tracers.values()) t.addProcessor(p);
  }

  /** Get (or create) a named tracer. */
  getTracer(name: string): Tracer {
    let t = this.tracers.get(name);
    if (!t) {
      t = new Tracer(name);
      for (const p of this.processors) t.addProcessor(p);
      this.tracers.set(name, t);
    }
    return t;
  }

  /** All registered tracers. */
  allTracers(): Tracer[] {
    return [...this.tracers.values()];
  }

  /** Flush every processor (force-flush buffered spans to exporters). */
  flushAll(): void {
    for (const p of this.processors) p.flush?.();
  }

  /** The in-memory exporter attached at construction (if any). */
  get inMemoryExporter(): InMemorySpanExporter | undefined {
    return this._defaultExporter;
  }

  /** Package-private: set by the singleton bootstrap below. */
  setDefaultExporter(e: InMemorySpanExporter): void {
    this._defaultExporter = e;
  }
}

// ---------------------------------------------------------------------------
// Predefined span names — PaySwap critical paths
// ---------------------------------------------------------------------------

export const SPAN_NAMES = {
  paymentCreate: 'payment.create',
  paymentRoute: 'payment.route',
  paymentSettle: 'payment.settle',
  payoutProcess: 'payout.process',
  ledgerPost: 'ledger.post',
  connectorQuery: 'connector.query',
  plannerSolve: 'planner.solve',
  complianceCheck: 'compliance.check',
} as const;

// ---------------------------------------------------------------------------
// Singleton bootstrap
// ---------------------------------------------------------------------------

const _globalForTracer = globalThis as unknown as {
  __PAYSWAP_TRACER_PROVIDER?: TracerProvider;
};

function bootstrapProvider(): TracerProvider {
  const provider = new TracerProvider();
  const exporter = new InMemorySpanExporter(10_000);
  provider.setDefaultExporter(exporter);
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  return provider;
}

export const tracerProvider: TracerProvider =
  _globalForTracer.__PAYSWAP_TRACER_PROVIDER ?? bootstrapProvider();
if (!_globalForTracer.__PAYSWAP_TRACER_PROVIDER) {
  _globalForTracer.__PAYSWAP_TRACER_PROVIDER = tracerProvider;
}

/** Default tracer — used by `withSpan(...)` callers that don't need a named one. */
export const tracer: Tracer = tracerProvider.getTracer('default');

/** Convenience: in-memory exporter singleton (used by dashboards / tests). */
export const inMemorySpanExporter: InMemorySpanExporter | undefined =
  tracerProvider.inMemoryExporter;

/** Convenience: start a span on the default tracer. */
export function startSpan(
  name: string,
  kind?: SpanKind,
  attributes?: Record<string, unknown>,
): StartedSpan {
  return tracer.startSpan(name, kind, attributes);
}

/** Convenience: run `fn` inside a span on the default tracer. */
export function withSpan<T>(
  name: string,
  fn: () => T,
  opts?: { kind?: SpanKind; attributes?: Record<string, unknown> },
): T {
  return tracer.withSpan(name, fn, opts);
}
