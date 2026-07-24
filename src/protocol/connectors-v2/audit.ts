/**
 * PaySwap Protocol — Production Connectors v2 — Audit Log.
 *
 * Every connector request — success OR failure — is audited. Audit = (a)
 * emit a `connector.audit` event on the kernel event bus (so the simulation
 * engine records it in the event stream for replay), and (b) append to an
 * in-memory ring buffer (last 10k entries) for fast paginated queries.
 *
 * Audit entries are serializable POJOs — safe to expose via /api/audit.
 */
import { eventEngine } from '@/kernel/event';
import type { ConnectorId, ConnectorRequest, ConnectorResponse } from './types';

export interface AuditEntry {
  ts: number;
  connectorId: ConnectorId;
  requestId: string;
  idempotencyKey: string;
  operation: string;
  success: boolean;
  latencyMs: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  evidenceId?: string;
  rateLimited?: boolean;
  cached?: boolean;
}

export interface AuditFilter {
  connectorId?: ConnectorId;
  operation?: string;
  success?: boolean;
  since?: number;
  until?: number;
  limit?: number;
}

const RING_BUFFER_CAPACITY = 10_000;

/**
 * In-memory audit ring buffer. Drop-in replaceable with a persistent store
 * (Postgres, ClickHouse, S3 + Athena). The shape of `AuditEntry` is stable.
 */
export class AuditLog {
  private buffer: AuditEntry[] = [];
  private head = 0; // next write slot
  private count = 0; // total entries written (monotonic, may exceed capacity)

  /**
   * Record a single request outcome. Emits `connector.audit` event AND
   * appends to the ring buffer.
   */
  log(
    connectorId: ConnectorId,
    request: ConnectorRequest,
    response: ConnectorResponse,
    opts: { rateLimited?: boolean; cached?: boolean } = {},
  ): AuditEntry {
    const entry: AuditEntry = {
      ts: Date.now(),
      connectorId,
      requestId: response.requestId,
      idempotencyKey: request.id,
      operation: request.operation,
      success: response.success,
      latencyMs: response.latencyMs,
      attempts: response.attempts,
      errorCode: response.error?.code,
      errorMessage: response.error?.message,
      evidenceId: response.evidence?.id,
      rateLimited: opts.rateLimited ?? (response.error?.code === 'RATE_LIMITED'),
      cached: opts.cached ?? (response.attempts === 0 && response.success),
    };

    // Append to ring buffer.
    if (this.count < RING_BUFFER_CAPACITY) {
      this.buffer.push(entry);
    } else {
      this.buffer[this.head] = entry;
    }
    this.head = (this.head + 1) % RING_BUFFER_CAPACITY;
    this.count += 1;

    // Emit kernel event for audit-stream replay.
    eventEngine.emit('connector.audit', entry as unknown as Record<string, unknown>);

    return entry;
  }

  /** Filtered query — returns entries newest-first by default. */
  query(filter: AuditFilter = {}): AuditEntry[] {
    const limit = filter.limit ?? 500;
    const out: AuditEntry[] = [];
    // Walk the ring buffer newest-first.
    for (let i = 0; i < this.buffer.length && out.length < limit; i += 1) {
      const idx = (this.head - 1 - i + RING_BUFFER_CAPACITY) % RING_BUFFER_CAPACITY;
      // Skip slots that haven't been written yet (initial fill phase).
      if (i >= this.count) break;
      const entry = this.buffer[idx];
      if (!entry) continue;
      if (filter.connectorId && entry.connectorId !== filter.connectorId) continue;
      if (filter.operation && entry.operation !== filter.operation) continue;
      if (filter.success !== undefined && entry.success !== filter.success) continue;
      if (filter.since !== undefined && entry.ts < filter.since) continue;
      if (filter.until !== undefined && entry.ts > filter.until) continue;
      out.push(entry);
    }
    return out;
  }

  /** Total entries written (monotonic — exceeds capacity once wrapped). */
  total(): number {
    return this.count;
  }

  /** Current in-buffer count (≤ RING_BUFFER_CAPACITY). */
  size(): number {
    return Math.min(this.count, this.buffer.length);
  }

  /** Clear the buffer. */
  reset(): void {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }
}

/** Singleton audit log instance — shared by all production connectors. */
export const auditLogInstance = new AuditLog();

/**
 * Functional API matching the spec:
 *   `auditLog(connectorId, request, response)` — emits event + appends.
 *
 * Thin wrapper around the singleton.
 */
export function auditLog(
  connectorId: ConnectorId,
  request: ConnectorRequest,
  response: ConnectorResponse,
  opts: { rateLimited?: boolean; cached?: boolean } = {},
): AuditEntry {
  return auditLogInstance.log(connectorId, request, response, opts);
}

/** Functional API: filtered audit query. */
export function getAuditLog(filter: AuditFilter = {}): AuditEntry[] {
  return auditLogInstance.query(filter);
}
