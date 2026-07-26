/**
 * PaySwap Protocol — Observability — Payment Analytics.
 *
 * Aggregates payment + payout activity into:
 *   - volume / count / success-rate over a time range
 *   - average settlement time over a time range
 *   - volume breakdowns by corridor, currency, payment method
 *   - hourly / daily / weekly time-series of volume
 *
 * Non-invasive by design:
 *   - `recordPayment(payment)` / `recordPayout(payout)` accept caller-shaped
 *     records (the protocol layer invokes them inline as payments flow).
 *   - `subscribe(eventBus?)` wires the service to the kernel `eventEngine`
 *     so payout state transitions emitted by `payout-service` are auto-
 *     ingested without any change to business logic.
 *
 * The kernel is FROZEN — this module imports only `round`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { round, nowTs } from '@/kernel/support';
import { eventEngine, type EventEngine } from '@/kernel/event';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeRange {
  from: number;
  to: number;
}

export type AggregationGranularity = 'hourly' | 'daily' | 'weekly';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/** Caller-supplied payment record. Unknown fields are tolerated. */
export interface PaymentRecord {
  id: string;
  merchantId?: string;
  amount: number;
  currency: string;
  fromCurrency?: string;
  toCurrency?: string;
  method?: string;
  corridor?: string;
  status: PaymentStatus;
  fee?: number;
  createdAt: number;
  settledAt?: number;
  settlementDurationMs?: number;
}

/** Caller-supplied payout record. */
export interface PayoutRecord {
  id: string;
  merchantId?: string;
  amount: number;
  currency: string;
  method?: string;
  status: PayoutStatus;
  fee?: number;
  createdAt: number;
  completedAt?: number;
}

export interface TimeSeriesPoint {
  ts: number;
  value: number;
  count: number;
}

export interface CorridorBreakdown {
  corridor: string;
  volume: number;
  count: number;
  successRate: number;
}

export interface CurrencyBreakdown {
  currency: string;
  volume: number;
  count: number;
}

export interface MethodBreakdown {
  method: string;
  volume: number;
  count: number;
  successRate: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

function corridorOf(p: PaymentRecord): string {
  if (p.corridor) return p.corridor;
  if (p.fromCurrency && p.toCurrency) return `${p.fromCurrency}→${p.toCurrency}`;
  return p.currency ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PaymentAnalyticsService {
  private payments: PaymentRecord[] = [];
  private payouts: PayoutRecord[] = [];
  private readonly maxRecords: number;
  private unsubscribe?: () => void;

  constructor(maxRecords = 100_000) {
    this.maxRecords = maxRecords;
  }

  /** Append a payment record. Keeps the most-recent `maxRecords`. */
  recordPayment(payment: PaymentRecord): void {
    this.payments.push(payment);
    if (this.payments.length > this.maxRecords) {
      this.payments = this.payments.slice(-this.maxRecords);
    }
  }

  /** Append a payout record. */
  recordPayout(payout: PayoutRecord): void {
    this.payouts.push(payout);
    if (this.payouts.length > this.maxRecords) {
      this.payouts = this.payouts.slice(-this.maxRecords);
    }
  }

  /** Total succeeded-payment volume in `range`. */
  getPaymentVolume(range: TimeRange): number {
    const total = this.payments
      .filter((p) => p.status === 'succeeded' && inRange(p.createdAt, range))
      .reduce((s, p) => s + p.amount, 0);
    return round(total, 2);
  }

  /** Total payment count in `range` (any status). */
  getPaymentCount(range: TimeRange): number {
    return this.payments.filter((p) => inRange(p.createdAt, range)).length;
  }

  /** Succeeded payments / total payments in `range` (%). */
  getSuccessRate(range: TimeRange): number {
    const all = this.payments.filter((p) => inRange(p.createdAt, range));
    if (all.length === 0) return 0;
    const ok = all.filter((p) => p.status === 'succeeded').length;
    return round((ok / all.length) * 100, 4);
  }

  /** Average settlement duration (ms) for payments settled within `range`. */
  getAvgSettlementTime(range: TimeRange): number {
    const settled = this.payments.filter(
      (p) =>
        p.settlementDurationMs !== undefined &&
        p.settlementDurationMs !== null &&
        inRange(p.createdAt, range),
    );
    if (settled.length === 0) return 0;
    const total = settled.reduce((s, p) => s + (p.settlementDurationMs ?? 0), 0);
    return round(total / settled.length, 2);
  }

  /** Volume + count + success-rate per corridor. */
  getVolumeByCorridor(range: TimeRange): CorridorBreakdown[] {
    const all = this.payments.filter((p) => inRange(p.createdAt, range));
    const map = new Map<string, { volume: number; count: number; succeeded: number; total: number }>();
    for (const p of all) {
      const c = corridorOf(p);
      const e = map.get(c) ?? { volume: 0, count: 0, succeeded: 0, total: 0 };
      e.total += 1;
      if (p.status === 'succeeded') {
        e.volume += p.amount;
        e.count += 1;
        e.succeeded += 1;
      }
      map.set(c, e);
    }
    return [...map.entries()]
      .map(([corridor, v]) => ({
        corridor,
        volume: round(v.volume, 2),
        count: v.count,
        successRate: v.total > 0 ? round((v.succeeded / v.total) * 100, 4) : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Volume + count per currency (succeeded payments only). */
  getVolumeByCurrency(range: TimeRange): CurrencyBreakdown[] {
    const all = this.payments.filter(
      (p) => p.status === 'succeeded' && inRange(p.createdAt, range),
    );
    const map = new Map<string, { volume: number; count: number }>();
    for (const p of all) {
      const cur = p.currency ?? 'unknown';
      const e = map.get(cur) ?? { volume: 0, count: 0 };
      e.volume += p.amount;
      e.count += 1;
      map.set(cur, e);
    }
    return [...map.entries()]
      .map(([currency, v]) => ({
        currency,
        volume: round(v.volume, 2),
        count: v.count,
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Volume + count + success-rate per payment method. */
  getVolumeByMethod(range: TimeRange): MethodBreakdown[] {
    const all = this.payments.filter((p) => inRange(p.createdAt, range));
    const map = new Map<string, { volume: number; count: number; succeeded: number; total: number }>();
    for (const p of all) {
      const m = p.method ?? 'unknown';
      const e = map.get(m) ?? { volume: 0, count: 0, succeeded: 0, total: 0 };
      e.total += 1;
      if (p.status === 'succeeded') {
        e.volume += p.amount;
        e.count += 1;
        e.succeeded += 1;
      }
      map.set(m, e);
    }
    return [...map.entries()]
      .map(([method, v]) => ({
        method,
        volume: round(v.volume, 2),
        count: v.count,
        successRate: v.total > 0 ? round((v.succeeded / v.total) * 100, 4) : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Hourly / daily / weekly time-series of succeeded-payment volume. */
  getTimeSeries(
    range: TimeRange,
    granularity: AggregationGranularity = 'hourly',
  ): TimeSeriesPoint[] {
    const bucketMs = granularity === 'hourly' ? HOUR_MS : granularity === 'daily' ? DAY_MS : WEEK_MS;
    const buckets = new Map<number, { volume: number; count: number }>();
    for (const p of this.payments) {
      if (!inRange(p.createdAt, range)) continue;
      if (p.status !== 'succeeded') continue;
      const bucket = Math.floor(p.createdAt / bucketMs) * bucketMs;
      const e = buckets.get(bucket) ?? { volume: 0, count: 0 };
      e.volume += p.amount;
      e.count += 1;
      buckets.set(bucket, e);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, v]) => ({ ts, value: round(v.volume, 2), count: v.count }));
  }

  /** Total payout volume in `range` (completed payouts). */
  getPayoutVolume(range: TimeRange): number {
    const total = this.payouts
      .filter((p) => p.status === 'completed' && inRange(p.createdAt, range))
      .reduce((s, p) => s + p.amount, 0);
    return round(total, 2);
  }

  /** Payout success rate (%) over `range`. */
  getPayoutSuccessRate(range: TimeRange): number {
    const all = this.payouts.filter((p) => inRange(p.createdAt, range));
    if (all.length === 0) return 0;
    const ok = all.filter((p) => p.status === 'completed').length;
    return round((ok / all.length) * 100, 4);
  }

  /** Total fee revenue from payments + payouts in `range`. */
  getFeeRevenue(range: TimeRange): number {
    const pFees = this.payments
      .filter((p) => inRange(p.createdAt, range))
      .reduce((s, p) => s + (p.fee ?? 0), 0);
    const xFees = this.payouts
      .filter((p) => inRange(p.createdAt, range))
      .reduce((s, p) => s + (p.fee ?? 0), 0);
    return round(pFees + xFees, 2);
  }

  /**
   * Subscribe to the kernel event bus. Auto-ingests payout state transitions
   * emitted by `payout-service` (payout.requested / .processing / .completed /
   * .failed / .cancelled). Returns an unsubscribe function.
   *
   * Business logic never blocks on analytics — the subscriber catches every
   * error and silently drops malformed payloads.
   */
  subscribe(eventBus: EventEngine = eventEngine): () => void {
    const handler = (event: { type: string; payload: Record<string, unknown>; ts: number }) => {
      try {
        if (!event.type.startsWith('payout.')) return;
        const p = event.payload as {
          payoutId?: string;
          merchantId?: string;
          amount?: number;
          currency?: string;
          method?: string;
          fee?: number;
        };
        const id = p.payoutId ?? '';
        if (!id) return;
        const existing = this.payouts.find((x) => x.id === id);
        const status: PayoutStatus =
          event.type === 'payout.completed'
            ? 'completed'
            : event.type === 'payout.failed'
              ? 'failed'
              : event.type === 'payout.cancelled'
                ? 'cancelled'
                : event.type === 'payout.processing'
                  ? 'processing'
                  : 'pending';
        if (existing) {
          existing.status = status;
          if (event.type === 'payout.completed') existing.completedAt = event.ts;
        } else {
          this.recordPayout({
            id,
            merchantId: p.merchantId,
            amount: p.amount ?? 0,
            currency: p.currency ?? '',
            method: p.method,
            status,
            fee: p.fee,
            createdAt: event.ts,
            completedAt: event.type === 'payout.completed' ? event.ts : undefined,
          });
        }
      } catch {
        // non-invasive — never throw
      }
    };
    const off = eventBus.on('payout.', handler);
    this.unsubscribe = off;
    return off;
  }

  /** Stop any active subscription. */
  unsubscribeAll(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /** Reset all stored records (testing only). */
  reset(): void {
    this.payments = [];
    this.payouts = [];
  }

  /** Snapshot counts (for dashboards). */
  stats(): { payments: number; payouts: number } {
    return { payments: this.payments.length, payouts: this.payouts.length };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForPayment = globalThis as unknown as {
  __PAYSWAP_PAYMENT_ANALYTICS?: PaymentAnalyticsService;
};

export const paymentAnalytics: PaymentAnalyticsService =
  _globalForPayment.__PAYSWAP_PAYMENT_ANALYTICS ?? new PaymentAnalyticsService();
if (!_globalForPayment.__PAYSWAP_PAYMENT_ANALYTICS) {
  _globalForPayment.__PAYSWAP_PAYMENT_ANALYTICS = paymentAnalytics;
}

/** Re-export for callers that need the EventEngine type. */
export type { EventEngine };
