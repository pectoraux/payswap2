/**
 * PaySwap Protocol — Production Connectors v2 — Connector Audit Trail.
 *
 * Every connector request is logged here, and a `connector.audit` event
 * is emitted on the kernel event bus. The audit log is a ring buffer
 * (last 10k entries) — enough for post-incident review without unbounded
 * memory growth.
 *
 * The audit trail is the compliance substrate: regulators and internal
 * risk can replay "what did the open_banking connector return for this
 * transfer id?" without re-invoking the rail.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';
import type { ConnectorId, ConnectorRequest, ConnectorResponse } from './types';

/** Single audit entry — pairs the request with its response. */
export interface ConnectorAuditEntry {
  ts: number;
  connectorId: ConnectorId;
  requestId: string;
  operation: string;
  params: Record<string, unknown>;
  success: boolean;
  latencyMs: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  evidenceId?: string;
}

/** Ring buffer capacity. Older entries are evicted FIFO. */
const RING_BUFFER_CAPACITY = 10_000;

const buffer: ConnectorAuditEntry[] = [];

/** Append + emit. Called by the base connector after every query. */
export function auditLog(
  connectorId: ConnectorId,
  request: ConnectorRequest,
  response: ConnectorResponse,
): ConnectorAuditEntry {
  const entry: ConnectorAuditEntry = {
    ts: nowTs(),
    connectorId,
    requestId: response.requestId,
    operation: request.operation,
    params: request.params,
    success: response.success,
    latencyMs: response.latencyMs,
    attempts: response.attempts,
    errorCode: response.error?.code,
    errorMessage: response.error?.message,
    evidenceId: response.evidence?.id,
  };

  buffer.push(entry);
  if (buffer.length > RING_BUFFER_CAPACITY) {
    buffer.splice(0, buffer.length - RING_BUFFER_CAPACITY);
  }

  eventEngine.emit('connector.audit', {
    connectorId,
    requestId: entry.requestId,
    operation: entry.operation,
    success: entry.success,
    latencyMs: entry.latencyMs,
    attempts: entry.attempts,
    errorCode: entry.errorCode,
    evidenceId: entry.evidenceId,
    ts: entry.ts,
  });

  return entry;
}

/** Optional filters accepted by `getAuditLog`. */
export interface AuditLogFilter {
  connectorId?: ConnectorId;
  requestId?: string;
  operation?: string;
  success?: boolean;
  /** Only entries at or after this timestamp (ms). */
  sinceTs?: number;
  /** Max number of entries to return (newest first). Default 100. */
  limit?: number;
}

/** Return audit entries matching the filter, newest first. */
export function getAuditLog(filter: AuditLogFilter = {}): ConnectorAuditEntry[] {
  const limit = filter.limit ?? 100;
  const out: ConnectorAuditEntry[] = [];
  // Iterate newest-first so we can stop early once we hit the limit.
  for (let i = buffer.length - 1; i >= 0; i--) {
    const e = buffer[i];
    if (filter.connectorId && e.connectorId !== filter.connectorId) continue;
    if (filter.requestId && e.requestId !== filter.requestId) continue;
    if (filter.operation && e.operation !== filter.operation) continue;
    if (filter.success !== undefined && e.success !== filter.success) continue;
    if (filter.sinceTs !== undefined && e.ts < filter.sinceTs) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Number of entries currently in the buffer. */
export function auditLogSize(): number {
  return buffer.length;
}

/** Drop all audit entries (e.g. between simulation runs). */
export function clearAuditLog(): void {
  buffer.length = 0;
}

/**
 * Object-shaped facade over the module-level audit buffer. Mirrors the
 * functional surface (`auditLog`, `getAuditLog`, `auditLogSize`,
 * `clearAuditLog`) so callers can hold a single reference and call
 * `auditLogInstance.reset()` / `auditLogInstance.query(filter)` /
 * `auditLogInstance.size()`. Used by the connectors-v2 test suite.
 */
export const auditLogInstance = {
  /** Append a request/response pair to the audit trail + emit event. */
  log: auditLog,
  /** Filtered query — returns matching entries, newest first. */
  query: getAuditLog,
  /** Drop every entry from the buffer. */
  reset: clearAuditLog,
  /** Number of entries currently held. */
  size: auditLogSize,
};
