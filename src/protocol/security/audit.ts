/**
 * PaySwap Protocol — Security — Audit Trails.
 *
 * Append-only audit log of every privileged action. Ring buffer (last 50k
 * events) + emits a `security.audit` kernel event per record (so the
 * ops/event-sourcing layer can persist it).
 *
 * Each AuditEvent records:
 *   - WHO:    actor (user / api_key / system) + id + role + scopes + ip
 *   - WHAT:   action (e.g. 'payment.create', 'payout.process')
 *   - WHICH:  resource (type + id)
 *   - RESULT: success | denied | error
 *   - WHEN:   timestamp
 *   - TRACE:  correlation (traceId + spanId) for cross-service tracing
 *   - DETAILS: arbitrary structured detail (PII should be minimized)
 *
 * Frozen-kernel compliance: imports only `eventEngine` + `uid` (read-only).
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditActorType = 'user' | 'api_key' | 'system';

export interface AuditActor {
  type: AuditActorType;
  id: string;
  merchantId?: string;
  role?: string;
  scopes?: string[];
  ip?: string;
}

export type AuditResult = 'success' | 'denied' | 'error';

export interface AuditResource {
  type: string;
  id: string;
}

export interface AuditCorrelation {
  traceId: string;
  spanId: string;
}

export interface AuditEvent {
  /** Unique event ID (aud_<...>). */
  id: string;
  /** Epoch milliseconds. */
  ts: number;
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  result: AuditResult;
  correlation?: AuditCorrelation;
  details?: Record<string, unknown>;
}

export interface AuditQueryFilter {
  actorId?: string;
  actorType?: AuditActorType;
  merchantId?: string;
  action?: string | string[];
  resourceType?: string;
  resourceId?: string;
  result?: AuditResult | AuditResult[];
  since?: number;
  until?: number;
  traceId?: string;
  limit?: number;
}

// ─── Pre-defined actions ─────────────────────────────────────────────────────

export const AUDIT_ACTIONS = [
  'payment.create',
  'payment.refund',
  'payout.request',
  'payout.process',
  'payout.approve',
  'merchant.onboard',
  'merchant.verify',
  'merchant.suspend',
  'api_key.create',
  'api_key.revoke',
  'webhook.setup',
  'webhook.delete',
  'treasury.freeze',
  'treasury.rebalance',
  'treasury.draw',
  'lp.register',
  'lp.pause',
  'lp.slash',
  'login',
  'logout',
  'mfa.enroll',
  'mfa.verify',
  'mfa.disable',
  'permission.denied',
  'jwt.rotate',
  'secrets.rotate',
  'hsm.rotate',
  'device.trust',
  'device.revoke',
  'rate_limit.exceeded',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ─── AuditLog ────────────────────────────────────────────────────────────────

const DEFAULT_RING_SIZE = 50_000;

export class AuditLog {
  private buffer: AuditEvent[] = [];
  private readonly max: number;

  constructor(max = DEFAULT_RING_SIZE) {
    this.max = max;
  }

  /** Record an audit event. Also emits `security.audit` kernel event.
   *  Returns the created event (with id + ts filled in). */
  record(event: Omit<AuditEvent, 'id' | 'ts'>): AuditEvent {
    const full: AuditEvent = {
      ...event,
      id: uid('aud'),
      ts: nowTs(),
    };
    this.buffer.push(full);
    if (this.buffer.length > this.max) this.buffer.shift();
    eventEngine.emit('security.audit', full, 0);
    return full;
  }

  /** Query the audit log with filters. Returns newest-last. */
  query(filter: AuditQueryFilter = {}): AuditEvent[] {
    let out = this.buffer;
    if (filter.actorId) out = out.filter((e) => e.actor.id === filter.actorId);
    if (filter.actorType) out = out.filter((e) => e.actor.type === filter.actorType);
    if (filter.merchantId) out = out.filter((e) => e.actor.merchantId === filter.merchantId);
    if (filter.action) {
      const actions = Array.isArray(filter.action) ? filter.action : [filter.action];
      out = out.filter((e) => actions.includes(e.action));
    }
    if (filter.resourceType) out = out.filter((e) => e.resource.type === filter.resourceType);
    if (filter.resourceId) out = out.filter((e) => e.resource.id === filter.resourceId);
    if (filter.result) {
      const results = Array.isArray(filter.result) ? filter.result : [filter.result];
      out = out.filter((e) => results.includes(e.result));
    }
    if (filter.since !== undefined) out = out.filter((e) => e.ts >= filter.since!);
    if (filter.until !== undefined) out = out.filter((e) => e.ts <= filter.until!);
    if (filter.traceId) out = out.filter((e) => e.correlation?.traceId === filter.traceId);
    if (filter.limit !== undefined && out.length > filter.limit) {
      out = out.slice(out.length - filter.limit);
    }
    return out;
  }

  /** Most recent N events (newest-last). */
  recent(limit = 100): AuditEvent[] {
    return this.buffer.slice(Math.max(0, this.buffer.length - limit));
  }

  /** Total events currently in the buffer. */
  size(): number {
    return this.buffer.length;
  }

  /** Reset (for tests). */
  reset(): void {
    this.buffer = [];
  }
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

/** Record a successful action. */
export function auditSuccess(
  log: AuditLog,
  actor: AuditActor,
  action: string,
  resource: AuditResource,
  details?: Record<string, unknown>,
  correlation?: AuditCorrelation,
): AuditEvent {
  return log.record({ actor, action, resource, result: 'success', details, correlation });
}

/** Record a denied action (permission / scope failure). */
export function auditDenied(
  log: AuditLog,
  actor: AuditActor,
  action: string,
  resource: AuditResource,
  details?: Record<string, unknown>,
  correlation?: AuditCorrelation,
): AuditEvent {
  return log.record({ actor, action, resource, result: 'denied', details, correlation });
}

/** Record an errored action. */
export function auditError(
  log: AuditLog,
  actor: AuditActor,
  action: string,
  resource: AuditResource,
  details?: Record<string, unknown>,
  correlation?: AuditCorrelation,
): AuditEvent {
  return log.record({ actor, action, resource, result: 'error', details, correlation });
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const auditLog = new AuditLog();
