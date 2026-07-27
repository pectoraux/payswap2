/**
 * PaymentsService — the read model + writer for the payments capability.
 * (M-RT-18, recreated for M-RT-19.)
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  PaymentView,
  PaymentListOptions,
  PaymentRecordedPayload,
  PrismaPaymentRow,
} from './types';
import { PaymentProjection } from './projection';
import type { ProjectionHealth } from '../../migration/types';

export interface PaymentsServiceInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
}

export interface RecordPaymentInput {
  paymentId: string;
  merchantId: string;
  customerId: string | null;
  reference: string | null;
  amount: number;
  currency: string;
  sourceCurrency: string | null;
  destinationCurrency: string | null;
  status: string;
  method: string | null;
  corridor: string | null;
  lpId: string | null;
  fee: number;
  netAmount: number;
  fxRate: number;
  description: string | null;
  createdAt: number;
  settledAt: number | null;
  environment: Environment;
  actorId: string;
  correlationId: string;
}

export class PaymentsService {
  readonly projection: PaymentProjection;

  constructor(private inputs: PaymentsServiceInputs) {
    this.projection = new PaymentProjection();
  }

  async list(merchantId: string, opts?: PaymentListOptions): Promise<PaymentView[]> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.list(merchantId, opts);
  }

  async count(merchantId: string): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.count(merchantId);
  }

  async aggregateVolume(merchantId: string): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.aggregateVolume(merchantId);
  }

  async get(paymentId: string): Promise<PaymentView | null> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.get(paymentId);
  }

  async totalAll(): Promise<number> {
    this.triggerLazyBackfill();
    await this.ensureHydrated();
    return this.projection.totalAll();
  }

  async recordPayment(input: RecordPaymentInput): Promise<boolean> {
    const streamId = `${input.environment}:payment:${input.paymentId}`;
    if (this.inputs.eventStore.streamVersion(streamId) !== undefined) {
      return false;
    }
    const payload: PaymentRecordedPayload = {
      paymentId: input.paymentId,
      merchantId: input.merchantId,
      customerId: input.customerId,
      reference: input.reference,
      amount: input.amount,
      currency: input.currency,
      sourceCurrency: input.sourceCurrency,
      destinationCurrency: input.destinationCurrency,
      status: input.status,
      method: input.method,
      corridor: input.corridor,
      lpId: input.lpId,
      fee: input.fee,
      netAmount: input.netAmount,
      fxRate: input.fxRate,
      description: input.description,
      createdAt: input.createdAt,
      settledAt: input.settledAt,
    };
    await this.inputs.eventStore.append(
      [{
        type: 'payment.recorded',
        streamId,
        streamType: 'payment',
        kind: 'domain',
        payload: payload as unknown as Record<string, unknown>,
      }],
      new Map([[streamId, -1]]),
      {
        intentId: `backfill_${input.paymentId}`,
        correlationId: input.correlationId,
        actor: input.actorId,
        environment: input.environment,
        timestamp: this.inputs.clock.now(),
      },
    );
    return true;
  }

  async health(canonicalRows?: number): Promise<ProjectionHealth> {
    await this.ensureHydrated();
    const rows = this.projection.totalAll();
    const eventsApplied = this.projection.eventsApplied();
    const checkpoint = this.projection.checkpoint();
    let lag = 0;
    try {
      const events = await this.inputs.eventStore.readAll(checkpoint + 1, 50_000);
      lag = events.filter((e) => e.streamType === 'payment').length;
    } catch {
      lag = 0;
    }
    const healthy = lag === 0 && (canonicalRows === undefined || rows >= canonicalRows);
    return {
      projection: 'payments',
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
        : healthy ? 'Healthy' : `Lagging by ${lag} events`,
    };
  }

  private hydrated = false;
  _onFirstRead?: () => void;

  private triggerLazyBackfill(): void {
    if (this._onFirstRead) this._onFirstRead();
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    const events = await this.inputs.eventStore.readAll(0, 50_000);
    const paymentEvents = events.filter((e) => e.streamType === 'payment' && e.type.startsWith('payment.'));
    if (paymentEvents.length > 0) {
      await this.projection.apply(paymentEvents);
    }
    this.hydrated = true;
  }
}
