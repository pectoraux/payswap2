/**
 * PaySwap Protocol — Operational Readiness — Structured JSON Logger.
 *
 * A minimal `pino`-compatible JSON logger built on Node built-ins. Every
 * log line is a single JSON object on stdout, containing at minimum
 * `ts`, `level`, `msg`. If a correlation context is active (set via
 * `withCorrelation` from `./correlation`), it is automatically attached
 * as the `correlation` field — so every log line in a request can be
 * traced back to the originating trace/span/request IDs.
 *
 * API surface mirrors `pino`:
 *
 *   import { logger } from '@/protocol/ops/logger';
 *   logger.info('payment received', { amount: 500, currency: 'KES' });
 *   const child = logger.child({ merchantId: 'm_123' });
 *   child.info('payout queued');
 *
 * Also exposes a `LogBuffer` ring buffer (last 5000 entries) that the ops
 * dashboard queries to show recent log activity without grepping stdout.
 */
import { currentCorrelation, type CorrelationContext } from './correlation';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  /** Epoch milliseconds. */
  ts: number;
  level: LogLevel;
  msg: string;
  /** Active correlation context (traceId/spanId/...), if any. */
  correlation?: CorrelationContext;
  /** Structured fields — merged from logger defaults + per-call fields. */
  fields?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

// ─── LogBuffer ───────────────────────────────────────────────────────────────

/**
 * A fixed-capacity ring buffer of log entries. The ops dashboard queries
 * this to render recent activity. Older entries are evicted FIFO.
 */
export class LogBuffer {
  private buffer: LogEntry[] = [];
  private readonly max: number;

  constructor(max = 5000) {
    this.max = max;
  }

  /** Push a new entry; evicts the oldest if at capacity. */
  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.max) this.buffer.shift();
  }

  /** All entries (newest last). */
  all(): LogEntry[] {
    return [...this.buffer];
  }

  /** Query with optional filters. */
  query(filter?: {
    level?: LogLevel | LogLevel[];
    since?: number;
    until?: number;
    traceId?: string;
    spanId?: string;
    requestId?: string;
    msgIncludes?: string;
    limit?: number;
  }): LogEntry[] {
    let out = this.buffer;
    if (filter?.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      out = out.filter((e) => levels.includes(e.level));
    }
    if (filter?.since !== undefined) out = out.filter((e) => e.ts >= filter.since!);
    if (filter?.until !== undefined) out = out.filter((e) => e.ts <= filter.until!);
    if (filter?.traceId) out = out.filter((e) => e.correlation?.traceId === filter.traceId);
    if (filter?.spanId) out = out.filter((e) => e.correlation?.spanId === filter.spanId);
    if (filter?.requestId) out = out.filter((e) => e.correlation?.requestId === filter.requestId);
    if (filter?.msgIncludes) out = out.filter((e) => e.msg.includes(filter.msgIncludes!));
    if (filter?.limit !== undefined && out.length > filter.limit) {
      out = out.slice(out.length - filter.limit);
    }
    return out;
  }

  /** Count by level — useful for dashboard KPIs. */
  counts(): Record<LogLevel, number> {
    const out: Record<LogLevel, number> = {
      debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
    };
    for (const e of this.buffer) out[e.level] += 1;
    return out;
  }

  /** Clear the buffer. */
  reset(): void {
    this.buffer = [];
  }

  /** Current length. */
  size(): number {
    return this.buffer.length;
  }
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface LoggerOptions {
  /** Default fields merged into every log entry. */
  defaultFields?: Record<string, unknown>;
  /** Minimum level to emit (default 'debug'). */
  minLevel?: LogLevel;
  /** Optional sink — defaults to console.log (one JSON line per entry). */
  sink?: (entry: LogEntry) => void;
  /** Log buffer (shared by parent/child loggers). */
  buffer?: LogBuffer;
  /** Logger name (shown as fields.name). */
  name?: string;
}

/**
 * JSON structured logger. Auto-attaches the active correlation context.
 * Create child loggers with `child()` to add default fields (e.g.
 * `logger.child({ merchantId })`).
 */
export class Logger {
  private readonly defaultFields: Record<string, unknown>;
  private readonly minLevel: LogLevel;
  private readonly sink: (entry: LogEntry) => void;
  private readonly buffer: LogBuffer;
  private readonly name?: string;

  constructor(opts: LoggerOptions = {}) {
    this.defaultFields = opts.defaultFields ?? {};
    this.minLevel = opts.minLevel ?? 'debug';
    this.sink = opts.sink ?? defaultSink;
    this.buffer = opts.buffer ?? sharedLogBuffer;
    this.name = opts.name;
  }

  /** Create a child logger whose default fields are merged with `fields`. */
  child(fields: Record<string, unknown>): Logger {
    return new Logger({
      defaultFields: { ...this.defaultFields, ...fields },
      minLevel: this.minLevel,
      sink: this.sink,
      buffer: this.buffer,
      name: this.name,
    });
  }

  /** Update the minimum level (returns a new logger — loggers are immutable). */
  level(minLevel: LogLevel): Logger {
    return new Logger({
      defaultFields: this.defaultFields,
      minLevel,
      sink: this.sink,
      buffer: this.buffer,
      name: this.name,
    });
  }

  /** Emit a log entry. */
  private log(level: LogLevel, msg: string, fields?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      msg,
      correlation: currentCorrelation(),
      fields: {
        ...(this.name ? { name: this.name } : {}),
        ...this.defaultFields,
        ...fields,
      },
    };
    // Always buffer (even below min level) so the dashboard can see the
    // full history if needed. Stdout is gated by minLevel.
    this.buffer.push(entry);
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel]) {
      this.sink(entry);
    }
    return entry;
  }

  debug(msg: string, fields?: Record<string, unknown>): LogEntry {
    return this.log('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): LogEntry {
    return this.log('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): LogEntry {
    return this.log('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): LogEntry {
    return this.log('error', msg, fields);
  }
  fatal(msg: string, fields?: Record<string, unknown>): LogEntry {
    return this.log('fatal', msg, fields);
  }
}

/**
 * Default sink: writes one JSON line to stdout. Uses `console.log`
 * (which writes to stdout with a trailing newline) for portability across
 * Node runtimes (including Next.js edge — though this module is
 * Node-only because `AsyncLocalStorage` is used elsewhere).
 */
function defaultSink(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

// ─── Singletons + helpers ─────────────────────────────────────────────────────

/** Shared log buffer (last 5000 entries). */
export const sharedLogBuffer = new LogBuffer(5000);

/** Singleton logger. */
export const logger = new Logger({ name: 'payswap' });

/** Shorthand: `log('hi', { ... })` ≡ `logger.info('hi', { ... })`. */
export const log = (msg: string, fields?: Record<string, unknown>): LogEntry =>
  logger.info(msg, fields);

/** Convenience: log at a specific level. */
export function logAt(level: LogLevel, msg: string, fields?: Record<string, unknown>): LogEntry {
  return logger[level](msg, fields);
}

export { ALL_LEVELS as LOG_LEVELS };
