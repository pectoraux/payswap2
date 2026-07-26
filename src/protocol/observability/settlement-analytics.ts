/**
 * PaySwap Protocol — Observability — Settlement Analytics.
 *
 * Aggregates settlement activity into:
 *   - count + average settlement time over a time range
 *   - per-corridor and per-LP breakdowns
 *   - failure rate over a time range
 *   - settlement-time distribution (p50 / p95 / p99)
 *
 * Non-invasive:
 *   - `recordSettlement(settlement)` accepts caller-shaped records.
 *   - `subscribe(eventBus?)` wires the service to `treasury.lp_settlement_recorded`
 *     events emitted by the treasury-v2 LP-profitability service, so every
 *     LP-settled transaction is auto-ingested.
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

export type SettlementStatus = 'pending' | 'succeeded' | 'failed';

export interface SettlementRecord {
  id: string;
  corridor?: string;
  lpId?: string;
  amount: number;
  currency: string;
  status: SettlementStatus;
  startedAt: number;
  settledAt?: number;
  durationMs?: number;
  failureReason?: string;
}

export interface CorridorSettlementBreakdown {
  corridor: string;
  count: number;
  volume: number;
  avgDurationMs: number;
  failureRate: number;
}

export interface LPSettlementBreakdown {
  lpId: string;
  count: number;
  volume: number;
  avgDurationMs: number;
  failureRate: number;
}

export interface SettlementDistribution {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

/**
 * Nearest-rank percentile. `p` ∈ [0,1]. Returns 0 for an empty input.
 * Matches the kernel metrics histogram's percentile semantics so dashboards
 * can mix the two without surprise.
 */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.max(1, Math.ceil(clamped * n));
  return sorted[Math.min(rank - 1, n - 1)];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SettlementAnalyticsService {
  private settlements: SettlementRecord[] = [];
  private readonly maxRecords: number;
  private unsubscribe?: () => void;

  constructor(maxRecords = 100_000) {
    this.maxRecords = maxRecords;
  }

  /** Append a settlement record. */
  recordSettlement(settlement: SettlementRecord): void {
    this.settlements.push(settlement);
    if (this.settlements.length > this.maxRecords) {
      this.settlements = this.settlements.slice(-this.maxRecords);
    }
  }

  /** Total settlement count in `range`. */
  getSettlementCount(range: TimeRange): number {
    return this.settlements.filter((s) => inRange(s.startedAt, range)).length;
  }

  /** Average settlement duration (ms) for settlements completed in `range`. */
  getAvgSettlementTime(range: TimeRange): number {
    const done = this.settlements.filter(
      (s) =>
        s.durationMs !== undefined &&
        s.durationMs !== null &&
        inRange(s.startedAt, range),
    );
    if (done.length === 0) return 0;
    const total = done.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    return round(total / done.length, 2);
  }

  /** Per-corridor breakdown: count, volume, avg duration, failure rate. */
  getSettlementByCorridor(range: TimeRange): CorridorSettlementBreakdown[] {
    const all = this.settlements.filter((s) => inRange(s.startedAt, range));
    const map = new Map<
      string,
      {
        count: number;
        volume: number;
        durations: number[];
        failed: number;
      }
    >();
    for (const s of all) {
      const c = s.corridor ?? 'unknown';
      const e = map.get(c) ?? { count: 0, volume: 0, durations: [], failed: 0 };
      e.count += 1;
      if (s.status === 'succeeded') e.volume += s.amount;
      if (s.status === 'failed') e.failed += 1;
      if (s.durationMs !== undefined) e.durations.push(s.durationMs);
      map.set(c, e);
    }
    return [...map.entries()]
      .map(([corridor, v]) => ({
        corridor,
        count: v.count,
        volume: round(v.volume, 2),
        avgDurationMs:
          v.durations.length > 0
            ? round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length, 2)
            : 0,
        failureRate: v.count > 0 ? round((v.failed / v.count) * 100, 4) : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Per-LP breakdown: count, volume, avg duration, failure rate. */
  getSettlementByLP(range: TimeRange): LPSettlementBreakdown[] {
    const all = this.settlements.filter((s) => inRange(s.startedAt, range));
    const map = new Map<
      string,
      {
        count: number;
        volume: number;
        durations: number[];
        failed: number;
      }
    >();
    for (const s of all) {
      const lp = s.lpId ?? 'unknown';
      const e = map.get(lp) ?? { count: 0, volume: 0, durations: [], failed: 0 };
      e.count += 1;
      if (s.status === 'succeeded') e.volume += s.amount;
      if (s.status === 'failed') e.failed += 1;
      if (s.durationMs !== undefined) e.durations.push(s.durationMs);
      map.set(lp, e);
    }
    return [...map.entries()]
      .map(([lpId, v]) => ({
        lpId,
        count: v.count,
        volume: round(v.volume, 2),
        avgDurationMs:
          v.durations.length > 0
            ? round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length, 2)
            : 0,
        failureRate: v.count > 0 ? round((v.failed / v.count) * 100, 4) : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Settlement failure rate (%) in `range`. */
  getFailureRate(range: TimeRange): number {
    const all = this.settlements.filter((s) => inRange(s.startedAt, range));
    if (all.length === 0) return 0;
    const failed = all.filter((s) => s.status === 'failed').length;
    return round((failed / all.length) * 100, 4);
  }

  /** Settlement-time distribution (p50/p95/p99 + min/max/avg) in `range`. */
  getSettlementTimeDistribution(range: TimeRange): SettlementDistribution {
    const durations = this.settlements
      .filter(
        (s) =>
          s.durationMs !== undefined &&
          s.durationMs !== null &&
          inRange(s.startedAt, range),
      )
      .map((s) => s.durationMs as number)
      .sort((a, b) => a - b);
    const n = durations.length;
    if (n === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
    }
    const sum = durations.reduce((a, b) => a + b, 0);
    return {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      min: durations[0],
      max: durations[n - 1],
      avg: round(sum / n, 2),
      count: n,
    };
  }

  /** Total succeeded-settlement volume in `range`. */
  getSettlementVolume(range: TimeRange): number {
    const total = this.settlements
      .filter((s) => s.status === 'succeeded' && inRange(s.startedAt, range))
      .reduce((sum, s) => sum + s.amount, 0);
    return round(total, 2);
  }

  /**
   * Subscribe to the kernel event bus. Auto-ingests
   * `treasury.lp_settlement_recorded` events emitted by the treasury-v2 LP
   * profitability service. Each event payload is shaped as
   * `{ lpId, corridor, volume, fee, cost?, ts? }`.
   */
  subscribe(eventBus: EventEngine = eventEngine): () => void {
    const handler = (event: { type: string; payload: Record<string, unknown>; ts: number }) => {
      try {
        if (event.type !== 'treasury.lp_settlement_recorded') return;
        const p = event.payload as {
          lpId?: string;
          corridor?: string;
          volume?: number;
          fee?: number;
          cost?: number;
          ts?: number;
        };
        const ts = p.ts ?? event.ts;
        this.recordSettlement({
          id: `s_${ts}_${p.lpId ?? 'x'}`,
          lpId: p.lpId,
          corridor: p.corridor,
          amount: p.volume ?? 0,
          currency: '',
          status: 'succeeded',
          startedAt: ts,
          settledAt: ts,
          durationMs: 0,
        });
      } catch {
        // non-invasive
      }
    };
    const off = eventBus.on('treasury.', handler);
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
    this.settlements = [];
  }

  /** Snapshot count. */
  stats(): { settlements: number } {
    return { settlements: this.settlements.length };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForSettlement = globalThis as unknown as {
  __PAYSWAP_SETTLEMENT_ANALYTICS?: SettlementAnalyticsService;
};

export const settlementAnalytics: SettlementAnalyticsService =
  _globalForSettlement.__PAYSWAP_SETTLEMENT_ANALYTICS ?? new SettlementAnalyticsService();
if (!_globalForSettlement.__PAYSWAP_SETTLEMENT_ANALYTICS) {
  _globalForSettlement.__PAYSWAP_SETTLEMENT_ANALYTICS = settlementAnalytics;
}

export type { EventEngine };
export const _now = nowTs; // re-exported for tests that want to monkeypatch
