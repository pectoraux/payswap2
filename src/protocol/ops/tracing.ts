/**
 * PaySwap Protocol — Operational Readiness — OpenTelemetry-style Traces.
 *
 * A minimal span-based tracing system that mirrors the OpenTelemetry
 * `TracerProvider` / `Tracer` / `Span` API surface. Built on Node
 * built-ins — `AsyncLocalStorage` (from `./correlation`) propagates the
 * active context so spans auto-link to their parent. Swapping to
 * `@opentelemetry/sdk-trace-base` later is mechanical:
 *
 *   // Current:
 *   import { withSpan } from '@/protocol/ops/tracing';
 *   const result = withSpan('payment.create', () => doPayment());
 *
 *   // OTel equivalent:
 *   import { trace } from '@opentelemetry/api';
 *   const tracer = trace.getTracer('payswap');
 *   const result = tracer.startActiveSpan('payment.create', span => {
 *     try { return doPayment(); } finally { span.end(); }
 *   });
 *
 * Spans are exported via `SpanExporter` implementations:
 *   - `InMemorySpanExporter` — keeps last N spans (queryable, for dashboards).
 *   - `ConsoleSpanExporter`  — logs JSON to stdout (for dev).
 *
 * A `SimpleSpanProcessor` synchronously calls the exporter on span end.
 */
import {
  currentCorrelation,
  enterCorrelation,
  newSpanId,
  newTraceId,
  type CorrelationContext,
} from './correlation';
import { logger } from './logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpanKind = 'internal' | 'client' | 'server' | 'producer' | 'consumer';
export type SpanStatus = 'ok' | 'error';

export interface SpanEvent {
  /** Event name (e.g. 'exception', 'queue.submit'). */
  name: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Event attributes. */
  attributes?: Record<string, string | number | boolean>;
}

export interface Span {
  /** 32-char hex trace ID. */
  traceId: string;
  /** 16-char hex span ID. */
  spanId: string;
  /** Parent span ID (undefined for root spans). */
  parentSpanId?: string;
  /** Span name — by convention dotted: 'payment.create'. */
  name: string;
  /** Span kind (OTel). */
  kind: SpanKind;
  /** Start time (epoch ms). */
  startTime: number;
  /** End time (epoch ms). Set when `end()` is called. */
  endTime?: number;
  /** Span attributes (string/number/boolean). */
  attributes: Record<string, string | number | boolean>;
  /** Events recorded during the span's lifetime. */
  events: SpanEvent[];
  /** Status: 'ok' or 'error'. */
  status: SpanStatus;
  /** HTTP-style status code (e.g. 200, 500) — optional. */
  statusCode?: number;
  /** Duration in ms (set when `endTime` is set). */
  durationMs?: number;
}

/** A span exporter — receives completed spans. */
export interface SpanExporter {
  export(spans: Span[]): void;
  /** Optional shutdown hook (called when the runtime shuts down). */
  shutdown?(): void;
}

/** A span processor — called on span start/end. Wraps an exporter. */
export interface SpanProcessor {
  onStart?(span: Span): void;
  onEnd(span: Span): void;
  shutdown?(): void;
}

// ─── Exporters ─────────────────────────────────────────────────────────────────

/**
 * In-memory span exporter — keeps the last `max` completed spans. Queryable
 * by traceId, name, status. Used by the ops dashboard to render recent
 * traces without an external collector.
 */
export class InMemorySpanExporter implements SpanExporter {
  private buffer: Span[] = [];
  private readonly max: number;

  constructor(max = 10000) {
    this.max = max;
  }

  export(spans: Span[]): void {
    for (const s of spans) {
      this.buffer.push(s);
      if (this.buffer.length > this.max) this.buffer.shift();
    }
  }

  shutdown(): void {
    this.buffer = [];
  }

  /** All buffered spans (newest last). */
  all(): Span[] {
    return [...this.buffer];
  }

  /** Query spans. */
  query(filter?: {
    traceId?: string;
    spanId?: string;
    name?: string;
    status?: SpanStatus;
    kind?: SpanKind;
    since?: number;
    until?: number;
    limit?: number;
  }): Span[] {
    let out = this.buffer;
    if (filter?.traceId) out = out.filter((s) => s.traceId === filter.traceId);
    if (filter?.spanId) out = out.filter((s) => s.spanId === filter.spanId);
    if (filter?.name) out = out.filter((s) => s.name === filter.name);
    if (filter?.status) out = out.filter((s) => s.status === filter.status);
    if (filter?.kind) out = out.filter((s) => s.kind === filter.kind);
    if (filter?.since !== undefined) out = out.filter((s) => s.startTime >= filter.since!);
    if (filter?.until !== undefined) out = out.filter((s) => (s.endTime ?? s.startTime) <= filter.until!);
    if (filter?.limit !== undefined && out.length > filter.limit) {
      out = out.slice(out.length - filter.limit);
    }
    return out;
  }

  /** All spans belonging to a trace, ordered by start time. */
  trace(traceId: string): Span[] {
    return this.query({ traceId }).sort((a, b) => a.startTime - b.startTime);
  }

  /** Count of buffered spans. */
  size(): number {
    return this.buffer.length;
  }

  /** Clear all buffered spans. */
  reset(): void {
    this.buffer = [];
  }
}

/**
 * Console span exporter — logs each completed span as a JSON line on
 * stdout. Useful for local development.
 */
export class ConsoleSpanExporter implements SpanExporter {
  export(spans: Span[]): void {
    for (const s of spans) {
      console.log(JSON.stringify({ type: 'span', ...s }));
    }
  }
  shutdown(): void {}
}

// ─── Processors ─────────────────────────────────────────────────────────────────

/**
 * Simple span processor — synchronously exports each span on end.
 * Equivalent to OTel's `SimpleSpanProcessor`.
 */
export class SimpleSpanProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter) {}

  onEnd(span: Span): void {
    try {
      this.exporter.export([span]);
    } catch (err) {
      // Exporter errors must never crash the application.
      console.error('span exporter error:', err);
    }
  }

  shutdown(): void {
    this.exporter.shutdown?.();
  }
}

// ─── Tracer ──────────────────────────────────────────────────────────────────

export interface StartSpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}

export interface StartedSpan {
  /** The span object. */
  span: Span;
  /**
   * End the span. Optionally merge in final attributes, set status, and
   * record a status code. Idempotent — calling end twice is a no-op.
   */
  end: (attributes?: Record<string, string | number | boolean>, status?: SpanStatus, statusCode?: number) => void;
  /** Record an event on the span. */
  addEvent: (name: string, attributes?: Record<string, string | number | boolean>) => void;
  /** Set an attribute on the span. */
  setAttribute: (key: string, value: string | number | boolean) => void;
}

/**
 * A tracer — produces spans. Each tracer shares the provider's processor
 * list (added by reference), so newly-added processors see spans from
 * existing tracers.
 */
export class Tracer {
  constructor(
    public readonly name: string,
    private readonly processors: SpanProcessor[],
  ) {}

  /**
   * Start a new span. Links to the active correlation context (traceId +
   * parentSpanId) automatically. Returns the span + an `end` function.
   *
   * NOTE: `startSpan` does NOT enter the span as the active correlation
   * context — use `withSpan` for that (so logs/spans created inside the
   * span's lifetime get this span's spanId).
   */
  startSpan(
    name: string,
    kind: SpanKind = 'internal',
    attributes: Record<string, string | number | boolean> = {},
  ): StartedSpan {
    const ctx = currentCorrelation();
    const span: Span = {
      traceId: ctx?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      parentSpanId: ctx?.spanId,
      name,
      kind,
      startTime: Date.now(),
      attributes: { ...attributes },
      events: [],
      status: 'ok',
    };
    for (const p of this.processors) p.onStart?.(span);

    let ended = false;
    const end = (
      endAttrs?: Record<string, string | number | boolean>,
      status: SpanStatus = 'ok',
      statusCode?: number,
    ): void => {
      if (ended) return;
      ended = true;
      span.endTime = Date.now();
      span.durationMs = span.endTime - span.startTime;
      if (endAttrs) Object.assign(span.attributes, endAttrs);
      span.status = status;
      if (statusCode !== undefined) span.statusCode = statusCode;
      for (const p of this.processors) p.onEnd(span);
    };

    const addEvent = (
      name: string,
      attributes?: Record<string, string | number | boolean>,
    ): void => {
      span.events.push({ name, ts: Date.now(), attributes });
    };

    const setAttribute = (key: string, value: string | number | boolean): void => {
      span.attributes[key] = value;
    };

    return { span, end, addEvent, setAttribute };
  }
}

// ─── TracerProvider ──────────────────────────────────────────────────────────

/**
 * Owns the processor pipeline and creates tracers. Singleton
 * `tracerProvider` is pre-configured with an `InMemorySpanExporter`
 * wrapped in a `SimpleSpanProcessor`.
 */
export class TracerProvider {
  private processors: SpanProcessor[] = [];
  private tracers: Map<string, Tracer> = new Map();

  /** Add a span processor (called for every span start/end). */
  addSpanProcessor(p: SpanProcessor): void {
    this.processors.push(p);
  }

  /** Get (or create) a named tracer. */
  getTracer(name = 'default'): Tracer {
    let t = this.tracers.get(name);
    if (!t) {
      t = new Tracer(name, this.processors);
      this.tracers.set(name, t);
    }
    return t;
  }

  /** Get all registered processors (for shutdown). */
  getProcessors(): SpanProcessor[] {
    return [...this.processors];
  }

  /** Shutdown all processors (and their exporters). */
  shutdown(): void {
    for (const p of this.processors) p.shutdown?.();
  }
}

// ─── withSpan ────────────────────────────────────────────────────────────────

export interface WithSpanOptions extends StartSpanOptions {
  /** Tracer name (default 'default'). */
  tracer?: string;
}

/**
 * Convenience: start a span, run `fn` inside its correlation scope, end
 * the span with the result. If `fn` throws, the span records an
 * 'exception' event, sets status='error', and re-throws.
 *
 * Returns whatever `fn` returns. The active correlation context inside
 * `fn` is updated to match this span — so nested spans and logs get the
 * correct spanId.
 *
 * Sync `fn` returns T directly; async `fn` returns Promise<T> (the
 * context propagates across awaited promises via AsyncLocalStorage).
 */
export function withSpan<T>(
  name: string,
  fn: () => T,
  opts?: WithSpanOptions,
): T {
  const tracer = tracerProvider.getTracer(opts?.tracer ?? 'default');
  const { span, end } = tracer.startSpan(name, opts?.kind, opts?.attributes);

  // Enter a correlation context that matches this span — so nested
  // logs/spans get this span's spanId as their parentSpanId.
  const cur = currentCorrelation();
  const ctx: CorrelationContext = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    requestId: cur?.requestId,
    userId: cur?.userId,
    merchantId: cur?.merchantId,
  };

  try {
    const result = enterCorrelation(ctx, fn);
    end();
    return result;
  } catch (err) {
    span.events.push({
      name: 'exception',
      ts: Date.now(),
      attributes: {
        'exception.message': err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack
          ? { 'exception.stack': err.stack }
          : {}),
        ...(err instanceof Error && err.name
          ? { 'exception.type': err.name }
          : {}),
      },
    });
    end({}, 'error');
    logger.warn('span ended with error', {
      span: span.name,
      traceId: span.traceId,
      spanId: span.spanId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Async variant of `withSpan`. Same semantics, but for `fn` returning a
 * Promise. The span ends when the promise resolves (or rejects).
 */
export async function withSpanAsync<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: WithSpanOptions,
): Promise<T> {
  const tracer = tracerProvider.getTracer(opts?.tracer ?? 'default');
  const { span, end } = tracer.startSpan(name, opts?.kind, opts?.attributes);

  const cur = currentCorrelation();
  const ctx: CorrelationContext = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    requestId: cur?.requestId,
    userId: cur?.userId,
    merchantId: cur?.merchantId,
  };

  try {
    const result = await enterCorrelation(ctx, fn);
    end();
    return result;
  } catch (err) {
    span.events.push({
      name: 'exception',
      ts: Date.now(),
      attributes: {
        'exception.message': err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack
          ? { 'exception.stack': err.stack }
          : {}),
        ...(err instanceof Error && err.name
          ? { 'exception.type': err.name }
          : {}),
      },
    });
    end({}, 'error');
    logger.warn('span ended with error', {
      span: span.name,
      traceId: span.traceId,
      spanId: span.spanId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── Predefined span names ─────────────────────────────────────────────────────

/**
 * Predefined span names — by convention, dotted lowercase. Using these
 * constants ensures dashboard queries can group spans by name reliably.
 */
export const SPAN_NAMES = {
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_ROUTE: 'payment.route',
  PAYMENT_SETTLE: 'payment.settle',
  PAYOUT_PROCESS: 'payout.process',
  LEDGER_POST: 'ledger.post',
  CONNECTOR_QUERY: 'connector.query',
  PLANNER_SOLVE: 'planner.solve',
  TREASURY_VERIFY: 'treasury.verify',
} as const;

// ─── Singleton ─────────────────────────────────────────────────────────────────

/** Singleton tracer provider — pre-configured with an in-memory exporter. */
export const tracerProvider = new TracerProvider();

/** Shared in-memory span exporter (registered on the singleton provider). */
export const inMemorySpanExporter = new InMemorySpanExporter(10000);

tracerProvider.addSpanProcessor(new SimpleSpanProcessor(inMemorySpanExporter));

/** Default tracer — convenience accessor. */
export const tracer = tracerProvider.getTracer('payswap');
