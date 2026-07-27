/**
 * RefundsService — the read model + writer for the refunds capability.
 * (M-RT-19, Capability Migration: Refunds.)
 *
 * Same discipline as PaymentsService (M-RT-18):
 *   - The service is the ONLY writer for `refund.requested` events.
 *   - The service reads from its projection (which is fed by the EventStore).
 *   - The service NEVER mutates the projection directly.
 *
 * WRITES (new events):
 *   - recordRefund()  — backfill / legacy import; emits refund.requested
 *   - markApproved()  — emits refund.approved
 *   - markRejected()  — emits refund.rejected
 *   - markExecuted()  — emits refund.executed
 *   - markFailed()    — emits refund.failed
 *
 * READS (from the projection):
 *   - list(merchantId, opts)
 *   - listByPayment(paymentId)
 *   - count(merchantId, status?)
 *   - aggregateAmount(merchantId)
 *   - pendingCount(merchantId)
 *   - get(refundId)
 *   - totalAll()
 *
 * HEALTH:
 *   - health() returns ProjectionHealth (eventsApplied, rows, lag, etc.)
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  RefundView,
  RefundListOptions,
  RefundRequestedPayload,
} from './types';
import { RefundProjection } from './projection';
import type { ProjectionHealth } from '../../migration/types';

/** Inputs to the RefundsService. */
export interface RefundsServiceInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
}

/** Optional inputs for recordRefund (the backfill path). */
export interface RecordRefundInput {
  refundId: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  environment: Environment;
  /** Epoch ms — the original createdAt of the refund (deterministic). */
  createdAt: number;
  correlationId: string;
}

/**
 * RefundsService — the read model + writer for refunds.
 */
export class RefundsService {
  readonly projection: RefundProjection;

  constructor(private inputs: RefundsServiceInputs) {
    this.projection = new RefundProjection();
  }

  // ── READS (façade contract) ─────────────────────────────────────────────

  async list(merchantId: string, opts?: RefundListOptions): Promise<RefundView[]> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.list(merchantId, opts);
  }

  async listByPayment(paymentId: string): Promise<RefundView[]> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.listByPayment(paymentId);
  }

  async count(merchantId: string): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.count(merchantId);
  }

  async aggregateAmount(merchantId: string): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.aggregateAmount(merchantId);
  }

  async pendingCount(merchantId: string): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.pendingCount(merchantId);
  }

  async get(refundId: string): Promise<RefundView | null> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.get(refundId);
  }

  async totalAll(): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.totalAll();
  }

  // ── WRITES (the service is the only writer for refund.* events) ─────────

  /** Record a refund (backfill / legacy import). Emits `refund.requested`. IDEMPOTENT. */
  async recordRefund(input: RecordRefundInput): Promise<boolean> {
    const streamId = `${input.environment}:refund:${input.refundId}`;
    // Idempotence: if the stream exists, skip.
    if (this.inputs.eventStore.streamVersion(streamId) !== undefined) {
      return false;
    }
    const payload: RefundRequestedPayload = {
      refundId: input.refundId,
      merchantId: input.merchantId,
      paymentId: input.paymentId,
      amount: input.amount,
      type: input.type,
      reason: input.reason,
      status: input.status,
      requestedBy: input.requestedBy,
      environment: input.environment,
      createdAt: input.createdAt,
    };
    await this.inputs.eventStore.append(
      [{
        type: 'refund.requested',
        streamId,
        streamType: 'refund',
        kind: 'domain',
        payload: payload as unknown as Record<string, unknown>,
      }],
      new Map([[streamId, -1]]),
      {
        intentId: `backfill_refund_${input.refundId}`,
        correlationId: input.correlationId,
        actor: 'system:backfill',
        environment: input.environment,
        timestamp: this.inputs.clock.now(),
      },
    );
    return true;
  }

  /** Mark a refund as approved. Emits `refund.approved`. */
  async markApproved(
    refundId: string,
    approvedBy: string,
    environment: Environment,
    correlationId: string,
  ): Promise<void> {
    const streamId = `${environment}:refund:${refundId}`;
    await this.inputs.eventStore.append(
      [{
        type: 'refund.approved',
        streamId,
        streamType: 'refund',
        kind: 'domain',
        payload: { refundId, approvedBy, approvedAt: this.inputs.clock.now() },
      }],
      new Map([[streamId, this.inputs.eventStore.streamVersion(streamId) ?? -1]]),
      {
        intentId: `approve_${refundId}`,
        correlationId,
        actor: approvedBy,
        environment,
        timestamp: this.inputs.clock.now(),
      },
    );
  }

  /** Mark a refund as rejected. Emits `refund.rejected`. */
  async markRejected(
    refundId: string,
    rejectedBy: string,
    reason: string,
    environment: Environment,
    correlationId: string,
  ): Promise<void> {
    const streamId = `${environment}:refund:${refundId}`;
    await this.inputs.eventStore.append(
      [{
        type: 'refund.rejected',
        streamId,
        streamType: 'refund',
        kind: 'domain',
        payload: { refundId, rejectedBy, reason, rejectedAt: this.inputs.clock.now() },
      }],
      new Map([[streamId, this.inputs.eventStore.streamVersion(streamId) ?? -1]]),
      {
        intentId: `reject_${refundId}`,
        correlationId,
        actor: rejectedBy,
        environment,
        timestamp: this.inputs.clock.now(),
      },
    );
  }

  /** Mark a refund as executed (funds returned). Emits `refund.executed`. */
  async markExecuted(
    refundId: string,
    environment: Environment,
    correlationId: string,
  ): Promise<void> {
    const streamId = `${environment}:refund:${refundId}`;
    await this.inputs.eventStore.append(
      [{
        type: 'refund.executed',
        streamId,
        streamType: 'refund',
        kind: 'domain',
        payload: { refundId, executedAt: this.inputs.clock.now() },
      }],
      new Map([[streamId, this.inputs.eventStore.streamVersion(streamId) ?? -1]]),
      {
        intentId: `execute_${refundId}`,
        correlationId,
        actor: 'system:executor',
        environment,
        timestamp: this.inputs.clock.now(),
      },
    );
  }

  /** Mark a refund as failed. Emits `refund.failed`. */
  async markFailed(
    refundId: string,
    reason: string,
    environment: Environment,
    correlationId: string,
  ): Promise<void> {
    const streamId = `${environment}:refund:${refundId}`;
    await this.inputs.eventStore.append(
      [{
        type: 'refund.failed',
        streamId,
        streamType: 'refund',
        kind: 'domain',
        payload: { refundId, reason, failedAt: this.inputs.clock.now() },
      }],
      new Map([[streamId, this.inputs.eventStore.streamVersion(streamId) ?? -1]]),
      {
        intentId: `fail_${refundId}`,
        correlationId,
        actor: 'system:executor',
        environment,
        timestamp: this.inputs.clock.now(),
      },
    );
  }

  // ── HEALTH ───────────────────────────────────────────────────────────────

  /**
   * Compute the projection's health. Called by the health registry.
   *
   * Lag = events in the EventStore with `streamType='refund'` that the
   * projection hasn't processed yet. For an in-memory projection subscribed
   * via ProjectionRunner, lag is normally 0 (events are applied synchronously
   * on append). Lag > 0 indicates the projection is falling behind.
   */
  async health(canonicalRows?: number): Promise<ProjectionHealth> {
    await this.ensureHydrated();
    const rows = this.projection.totalAll();
    const eventsApplied = this.projection.eventsApplied();
    const checkpoint = this.projection.checkpoint();
    // Lag: count refund events in the EventStore past the projection's checkpoint.
    // For an in-memory store, this is 0 (synchronous apply). We compute it
    // by reading the log and counting refund events past checkpoint.
    let lag = 0;
    try {
      const events = await this.inputs.eventStore.readAll(checkpoint + 1, 50_000);
      lag = events.filter((e) => e.streamType === 'refund').length;
    } catch {
      lag = 0;
    }
    const healthy = lag === 0 && (canonicalRows === undefined || rows >= canonicalRows);
    return {
      projection: 'refunds',
      version: 1,
      eventsApplied,
      rows,
      lag,
      healthy,
      lastReplayMs: this.projection.lastReplayDurationMs(),
      checkpoint,
      canonicalRows,
      message: canonicalRows !== undefined && rows < canonicalRows
        ? `Backfill pending: ${canonicalRows} in Prisma, ${rows} in projection`
        : healthy
          ? 'Healthy'
          : `Lagging by ${lag} events`,
    };
  }

  // ── Internal: hydrate + lazy backfill ───────────────────────────────────

  private hydrated = false;

  /** Lazy backfill hook — set by the runtime container. */
  _onFirstRead?: () => void;

  private triggerLazyBackfill(): void {
    if (this._onFirstRead) {
      this._onFirstRead();
    }
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    const events = await this.inputs.eventStore.readAll(0, 50_000);
    const refundEvents = events.filter(
      (e) => e.streamType === 'refund' && e.type.startsWith('refund.'),
    );
    if (refundEvents.length > 0) {
      await this.projection.apply(refundEvents);
    }
    this.hydrated = true;
  }
}
