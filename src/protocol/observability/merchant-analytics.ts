/**
 * PaySwap Protocol — Observability — Merchant Analytics.
 *
 * Aggregates merchant activity into:
 *   - top-N merchants by volume / transactions / revenue
 *   - merchant growth (new activations per period)
 *   - merchant churn (merchants gone dormant)
 *   - cohort analysis (merchants grouped by signup month)
 *   - per-merchant stats
 *
 * Non-invasive:
 *   - `recordMerchantActivity(merchantId, event)` is the canonical ingest
 *     point. `event.type` selects the activity kind ('payment' / 'refund' /
 *     'payout' / 'signup' / 'suspension' / 'reactivation'); the rest of the
 *     payload carries amount / currency / etc.
 *   - `subscribe(eventBus?)` wires the service to kernel merchant.* events
 *     emitted by `merchant/platform.ts` (merchant.onboarded, merchant.verified,
 *     merchant.invoice_paid, merchant.refund_processed, merchant.suspended).
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

export type MerchantActivityType =
  | 'signup'
  | 'payment'
  | 'refund'
  | 'payout'
  | 'suspension'
  | 'reactivation';

export interface MerchantActivityEvent {
  type: MerchantActivityType;
  amount?: number;
  currency?: string;
  method?: string;
  ts?: number;
  reason?: string;
}

export interface MerchantActivityRecord {
  merchantId: string;
  type: MerchantActivityType;
  amount: number;
  currency: string;
  method?: string;
  ts: number;
  reason?: string;
}

export interface MerchantStats {
  merchantId: string;
  totalVolume: number;
  totalTransactions: number;
  totalRefunds: number;
  refundRate: number;
  revenue: number;
  firstActivityTs: number;
  lastActivityTs: number;
  status: 'active' | 'dormant' | 'churned';
}

export interface TopMerchant {
  merchantId: string;
  value: number;
  transactions: number;
}

export interface MerchantGrowthPoint {
  ts: number;
  newMerchants: number;
  cumulative: number;
}

export interface MerchantChurnPoint {
  ts: number;
  churned: number;
  churnRate: number;
}

export interface MerchantCohort {
  cohortMonth: string; // YYYY-MM
  size: number;
  retainedAfter: { months: number; retained: number; retentionRate: number }[];
  totalVolume: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

/** Format a ts (ms) as `YYYY-MM`. */
function monthKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MerchantAnalyticsService {
  private activities: MerchantActivityRecord[] = [];
  private readonly maxRecords: number;
  /** merchantId → most-recent activity ts (used for churn detection). */
  private lastActivityByMerchant = new Map<string, number>();
  /** merchantId → first signup ts. */
  private signupByMerchant = new Map<string, number>();
  private unsubscribe?: () => void;

  constructor(maxRecords = 200_000) {
    this.maxRecords = maxRecords;
  }

  /** Record a merchant activity event. */
  recordMerchantActivity(merchantId: string, event: MerchantActivityEvent): void {
    const ts = event.ts ?? nowTs();
    const rec: MerchantActivityRecord = {
      merchantId,
      type: event.type,
      amount: event.amount ?? 0,
      currency: event.currency ?? '',
      method: event.method,
      ts,
      reason: event.reason,
    };
    this.activities.push(rec);
    if (this.activities.length > this.maxRecords) {
      this.activities = this.activities.slice(-this.maxRecords);
    }
    this.lastActivityByMerchant.set(merchantId, ts);
    if (event.type === 'signup' && !this.signupByMerchant.has(merchantId)) {
      this.signupByMerchant.set(merchantId, ts);
    }
  }

  /** Top-N merchants by volume / transactions / revenue. */
  getTopMerchants(
    by: 'volume' | 'transactions' | 'revenue',
    limit = 10,
    range: TimeRange,
  ): TopMerchant[] {
    const map = new Map<string, { volume: number; transactions: number; revenue: number }>();
    for (const a of this.activities) {
      if (!inRange(a.ts, range)) continue;
      const e = map.get(a.merchantId) ?? { volume: 0, transactions: 0, revenue: 0 };
      if (a.type === 'payment') {
        e.volume += a.amount;
        e.transactions += 1;
        // crude revenue proxy — 1% of payment volume
        e.revenue += a.amount * 0.01;
      } else if (a.type === 'refund') {
        e.volume -= a.amount;
        e.transactions -= 1;
        e.revenue -= a.amount * 0.01;
      }
      map.set(a.merchantId, e);
    }
    const key: 'volume' | 'transactions' | 'revenue' = by;
    return [...map.entries()]
      .map(([merchantId, v]) => ({
        merchantId,
        value: round(v[key], 2),
        transactions: v.transactions,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  /** New-merchant growth time-series (bucket = 1 day). */
  getMerchantGrowth(range: TimeRange, bucketMs = DAY_MS): MerchantGrowthPoint[] {
    const signups = [...this.signupByMerchant.entries()].filter(([, ts]) =>
      inRange(ts, range),
    );
    const buckets = new Map<number, number>();
    for (const [, ts] of signups) {
      const b = Math.floor(ts / bucketMs) * bucketMs;
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    let cumulative = 0;
    return sorted.map(([ts, newMerchants]) => {
      cumulative += newMerchants;
      return { ts, newMerchants, cumulative };
    });
  }

  /**
   * Churn time-series. A merchant is "churned" in a bucket if their last
   * activity ts is before the start of the bucket AND they had any prior
   * activity. `churnRate` = churned / total-known-merchants-at-bucket-start.
   */
  getMerchantChurn(range: TimeRange, bucketMs = DAY_MS, dormancyMs = 30 * DAY_MS): MerchantChurnPoint[] {
    const allMerchants = [...this.lastActivityByMerchant.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    const points: MerchantChurnPoint[] = [];
    for (let bucketStart = range.from; bucketStart <= range.to; bucketStart += bucketMs) {
      const bucketEnd = bucketStart + bucketMs;
      const knownByBucketStart = allMerchants.filter(([, ts]) => ts < bucketStart);
      if (knownByBucketStart.length === 0) {
        points.push({ ts: bucketStart, churned: 0, churnRate: 0 });
        continue;
      }
      let churned = 0;
      for (const [, lastTs] of knownByBucketStart) {
        if (bucketStart - lastTs > dormancyMs) {
          // last activity was more than `dormancyMs` before this bucket
          churned += 1;
        }
      }
      points.push({
        ts: bucketStart,
        churned,
        churnRate: round((churned / knownByBucketStart.length) * 100, 4),
      });
      // suppress unused var warning
      void bucketEnd;
    }
    return points;
  }

  /** Cohort analysis: merchants grouped by signup month, retention over time. */
  getMerchantCohort(cohortMonth: string): MerchantCohort {
    const members: { merchantId: string; signupTs: number }[] = [];
    for (const [merchantId, signupTs] of this.signupByMerchant.entries()) {
      if (monthKey(signupTs) === cohortMonth) {
        members.push({ merchantId, signupTs });
      }
    }
    const size = members.length;
    const totalVolume = members.reduce((sum, m) => {
      const vol = this.activities
        .filter((a) => a.merchantId === m.merchantId && a.type === 'payment')
        .reduce((s, a) => s + a.amount, 0);
      return sum + vol;
    }, 0);
    const retainedAfter: { months: number; retained: number; retentionRate: number }[] = [];
    for (let monthsAfter = 1; monthsAfter <= 12; monthsAfter++) {
      const cutoff = members[0]
        ? members[0].signupTs + monthsAfter * 30 * DAY_MS
        : 0;
      let retained = 0;
      for (const m of members) {
        const hadActivity = this.activities.some(
          (a) =>
            a.merchantId === m.merchantId &&
            a.ts >= m.signupTs &&
            a.ts <= m.signupTs + monthsAfter * 30 * DAY_MS,
        );
        if (hadActivity) retained += 1;
      }
      retainedAfter.push({
        months: monthsAfter,
        retained,
        retentionRate: size > 0 ? round((retained / size) * 100, 4) : 0,
      });
      void cutoff;
    }
    return { cohortMonth, size, retainedAfter, totalVolume: round(totalVolume, 2) };
  }

  /** Per-merchant stats. */
  getMerchantStats(merchantId: string, dormancyMs = 30 * DAY_MS): MerchantStats {
    const merchantActivities = this.activities.filter((a) => a.merchantId === merchantId);
    if (merchantActivities.length === 0) {
      return {
        merchantId,
        totalVolume: 0,
        totalTransactions: 0,
        totalRefunds: 0,
        refundRate: 0,
        revenue: 0,
        firstActivityTs: 0,
        lastActivityTs: 0,
        status: 'dormant',
      };
    }
    const payments = merchantActivities.filter((a) => a.type === 'payment');
    const refunds = merchantActivities.filter((a) => a.type === 'refund');
    const totalVolume = payments.reduce((s, a) => s + a.amount, 0);
    const totalRefunds = refunds.reduce((s, a) => s + a.amount, 0);
    const totalTransactions = payments.length;
    const revenue = totalVolume * 0.01 - totalRefunds * 0.01;
    const firstActivityTs = merchantActivities[0].ts;
    const lastActivityTs = merchantActivities[merchantActivities.length - 1].ts;
    const status: 'active' | 'dormant' | 'churned' =
      nowTs() - lastActivityTs > dormancyMs * 2
        ? 'churned'
        : nowTs() - lastActivityTs > dormancyMs
          ? 'dormant'
          : 'active';
    return {
      merchantId,
      totalVolume: round(totalVolume, 2),
      totalTransactions,
      totalRefunds: round(totalRefunds, 2),
      refundRate: totalTransactions > 0 ? round((refunds.length / totalTransactions) * 100, 4) : 0,
      revenue: round(revenue, 2),
      firstActivityTs,
      lastActivityTs,
      status,
    };
  }

  /** Total active merchant count (had activity in last `activeMs`). */
  getActiveMerchantCount(activeMs = 7 * DAY_MS): number {
    const cutoff = nowTs() - activeMs;
    let count = 0;
    for (const ts of this.lastActivityByMerchant.values()) {
      if (ts >= cutoff) count += 1;
    }
    return count;
  }

  /**
   * Subscribe to kernel merchant.* events. Auto-ingests signups, verifications,
   * invoice-paid (payments), refund-processed, and suspensions.
   */
  subscribe(eventBus: EventEngine = eventEngine): () => void {
    const handler = (event: { type: string; payload: Record<string, unknown>; ts: number }) => {
      try {
        if (!event.type.startsWith('merchant.')) return;
        const p = event.payload as {
          merchantId?: string;
          amount?: number;
          currency?: string;
          reason?: string;
        };
        const merchantId = p.merchantId;
        if (!merchantId) return;
        switch (event.type) {
          case 'merchant.onboarded':
            this.recordMerchantActivity(merchantId, { type: 'signup', ts: event.ts });
            break;
          case 'merchant.verified':
            // treated as a signup completion — no separate activity
            break;
          case 'merchant.invoice_paid':
            this.recordMerchantActivity(merchantId, {
              type: 'payment',
              amount: p.amount,
              currency: p.currency,
              ts: event.ts,
            });
            break;
          case 'merchant.refund_processed':
            this.recordMerchantActivity(merchantId, {
              type: 'refund',
              amount: p.amount,
              currency: p.currency,
              ts: event.ts,
            });
            break;
          case 'merchant.suspended':
            this.recordMerchantActivity(merchantId, {
              type: 'suspension',
              reason: p.reason,
              ts: event.ts,
            });
            break;
          default:
            break;
        }
      } catch {
        // non-invasive
      }
    };
    const off = eventBus.on('merchant.', handler);
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

  /** Reset (testing only). */
  reset(): void {
    this.activities = [];
    this.lastActivityByMerchant.clear();
    this.signupByMerchant.clear();
  }

  /** Snapshot counts. */
  stats(): { activities: number; merchants: number } {
    return {
      activities: this.activities.length,
      merchants: this.lastActivityByMerchant.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForMerchant = globalThis as unknown as {
  __PAYSWAP_MERCHANT_ANALYTICS?: MerchantAnalyticsService;
};

export const merchantAnalytics: MerchantAnalyticsService =
  _globalForMerchant.__PAYSWAP_MERCHANT_ANALYTICS ?? new MerchantAnalyticsService();
if (!_globalForMerchant.__PAYSWAP_MERCHANT_ANALYTICS) {
  _globalForMerchant.__PAYSWAP_MERCHANT_ANALYTICS = merchantAnalytics;
}

export type { EventEngine };
