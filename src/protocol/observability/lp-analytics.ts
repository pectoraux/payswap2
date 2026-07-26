/**
 * PaySwap Protocol — Observability — LP Analytics.
 *
 * Aggregates LP activity into:
 *   - top-N LPs by volume / settlements / revenue
 *   - per-LP utilization (currentExposure / authorizedExposure) time-series
 *   - LP reward distribution (fees earned per LP)
 *   - per-LP health score (composite of uptime, success rate, utilization,
 *     reputation)
 *   - corridor coverage (which corridors each LP serves)
 *
 * Non-invasive:
 *   - `recordLPActivity(lpId, event)` is the canonical ingest point.
 *   - `subscribe(eventBus?)` wires the service to `treasury.lp_settlement_recorded`
 *     and `lp.*` events emitted by the kernel + treasury-v2.
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

export type LPActivityType =
  | 'settlement'
  | 'stake'
  | 'unstake'
  | 'activate'
  | 'pause'
  | 'resume'
  | 'suspend'
  | 'slash'
  | 'exit';

export interface LPActivityEvent {
  type: LPActivityType;
  corridor?: string;
  volume?: number;
  fee?: number;
  amount?: number;
  reputation?: number;
  authorizedExposure?: number;
  currentExposure?: number;
  ts?: number;
  reason?: string;
}

export interface LPActivityRecord {
  lpId: string;
  type: LPActivityType;
  corridor?: string;
  volume: number;
  fee: number;
  amount: number;
  reputation?: number;
  authorizedExposure?: number;
  currentExposure?: number;
  ts: number;
  reason?: string;
}

export interface TopLP {
  lpId: string;
  value: number;
  settlements: number;
}

export interface LPReward {
  lpId: string;
  totalFees: number;
  settlementCount: number;
  avgFee: number;
  sharePct: number;
}

export interface LPUtilizationPoint {
  ts: number;
  authorizedExposure: number;
  currentExposure: number;
  utilization: number;
}

export interface LPHealthScore {
  lpId: string;
  score: number; // 0..100
  components: {
    uptime: number;
    successRate: number;
    utilization: number;
    reputation: number;
  };
  status: 'healthy' | 'warning' | 'critical';
}

export interface CorridorCoverage {
  corridor: string;
  lpCount: number;
  volume: number;
  uniqueLPs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LPAnalyticsService {
  private activities: LPActivityRecord[] = [];
  private readonly maxRecords: number;
  private unsubscribe?: () => void;

  constructor(maxRecords = 200_000) {
    this.maxRecords = maxRecords;
  }

  /** Record an LP activity event. */
  recordLPActivity(lpId: string, event: LPActivityEvent): void {
    const ts = event.ts ?? nowTs();
    const rec: LPActivityRecord = {
      lpId,
      type: event.type,
      corridor: event.corridor,
      volume: event.volume ?? 0,
      fee: event.fee ?? 0,
      amount: event.amount ?? 0,
      reputation: event.reputation,
      authorizedExposure: event.authorizedExposure,
      currentExposure: event.currentExposure,
      ts,
      reason: event.reason,
    };
    this.activities.push(rec);
    if (this.activities.length > this.maxRecords) {
      this.activities = this.activities.slice(-this.maxRecords);
    }
  }

  /** Top-N LPs by volume / settlements / revenue (fees). */
  getTopLPs(
    by: 'volume' | 'settlements' | 'revenue',
    limit = 10,
    range: TimeRange,
  ): TopLP[] {
    const map = new Map<string, { volume: number; settlements: number; revenue: number }>();
    for (const a of this.activities) {
      if (!inRange(a.ts, range)) continue;
      if (a.type !== 'settlement') continue;
      const e = map.get(a.lpId) ?? { volume: 0, settlements: 0, revenue: 0 };
      e.volume += a.volume;
      e.settlements += 1;
      e.revenue += a.fee;
      map.set(a.lpId, e);
    }
    const key: 'volume' | 'settlements' | 'revenue' = by;
    return [...map.entries()]
      .map(([lpId, v]) => ({
        lpId,
        value: round(v[key], 2),
        settlements: v.settlements,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  /** Per-LP utilization time-series (currentExposure / authorizedExposure). */
  getLPUtilization(lpId: string, range: TimeRange): LPUtilizationPoint[] {
    const points = this.activities
      .filter(
        (a) =>
          a.lpId === lpId &&
          inRange(a.ts, range) &&
          a.authorizedExposure !== undefined &&
          a.currentExposure !== undefined,
      )
      .map((a) => ({
        ts: a.ts,
        authorizedExposure: a.authorizedExposure ?? 0,
        currentExposure: a.currentExposure ?? 0,
        utilization:
          (a.authorizedExposure ?? 0) > 0
            ? round(((a.currentExposure ?? 0) / (a.authorizedExposure ?? 1)) * 100, 4)
            : 0,
      }))
      .sort((a, b) => a.ts - b.ts);
    return points;
  }

  /** LP reward distribution (fees earned) over `range`. */
  getLPRewardDistribution(range: TimeRange): LPReward[] {
    const map = new Map<string, { fees: number; count: number }>();
    let totalFees = 0;
    for (const a of this.activities) {
      if (!inRange(a.ts, range)) continue;
      if (a.type !== 'settlement') continue;
      const e = map.get(a.lpId) ?? { fees: 0, count: 0 };
      e.fees += a.fee;
      e.count += 1;
      totalFees += a.fee;
      map.set(a.lpId, e);
    }
    return [...map.entries()]
      .map(([lpId, v]) => ({
        lpId,
        totalFees: round(v.fees, 2),
        settlementCount: v.count,
        avgFee: v.count > 0 ? round(v.fees / v.count, 4) : 0,
        sharePct: totalFees > 0 ? round((v.fees / totalFees) * 100, 4) : 0,
      }))
      .sort((a, b) => b.totalFees - a.totalFees);
  }

  /**
   * Per-LP health score (0..100). Composite of:
   *   - uptime (settlement success rate)        — 30%
   *   - utilization (currentExposure / authExp) — 25%
   *   - settlement volume (relative)            — 20%
   *   - reputation (last known)                 — 25%
   */
  getLPHealthScore(lpId: string, range: TimeRange): LPHealthScore {
    const lpActivities = this.activities.filter(
      (a) => a.lpId === lpId && inRange(a.ts, range),
    );
    if (lpActivities.length === 0) {
      return {
        lpId,
        score: 0,
        components: { uptime: 0, successRate: 0, utilization: 0, reputation: 0 },
        status: 'critical',
      };
    }
    const settlements = lpActivities.filter((a) => a.type === 'settlement');
    const settlementCount = settlements.length;
    // Approximation: every recorded settlement is a success (we don't track
    // LP-side failures separately here). If we ever see a 'suspend' or 'slash'
    // event in range, dock the uptime.
    const negativeEvents = lpActivities.filter(
      (a) => a.type === 'suspend' || a.type === 'slash',
    ).length;
    const uptimePct = Math.max(
      0,
      100 - negativeEvents * 25,
    );
    const successRatePct = settlementCount > 0 ? 100 : 0;
    // Utilization: latest known utilization point.
    const utilizations = this.getLPUtilization(lpId, range);
    const latestUtil = utilizations.length > 0 ? utilizations[utilizations.length - 1].utilization : 0;
    // Volume component: relative to max LP in range.
    const topLPs = this.getTopLPs('volume', 1, range);
    const maxVolume = topLPs[0]?.value ?? 0;
    const lpVolume = settlements.reduce((s, a) => s + a.volume, 0);
    const volumePct = maxVolume > 0 ? round((lpVolume / maxVolume) * 100, 2) : 0;
    // Reputation: latest known.
    const lastWithReputation = [...lpActivities].reverse().find((a) => a.reputation !== undefined);
    const reputationPct = lastWithReputation
      ? round((lastWithReputation.reputation ?? 0) * 100, 2)
      : 50;

    const score = round(
      uptimePct * 0.3 + successRatePct * 0.1 + latestUtil * 0.25 + volumePct * 0.1 + reputationPct * 0.25,
      2,
    );
    const status: 'healthy' | 'warning' | 'critical' =
      score >= 75 ? 'healthy' : score >= 50 ? 'warning' : 'critical';
    return {
      lpId,
      score,
      components: {
        uptime: uptimePct,
        successRate: successRatePct,
        utilization: latestUtil,
        reputation: reputationPct,
      },
      status,
    };
  }

  /** Corridor coverage — which corridors each LP serves. */
  getCorridorCoverage(range: TimeRange): CorridorCoverage[] {
    const map = new Map<string, { lpSet: Set<string>; volume: number }>();
    for (const a of this.activities) {
      if (!inRange(a.ts, range)) continue;
      if (a.type !== 'settlement') continue;
      const c = a.corridor ?? 'unknown';
      const e = map.get(c) ?? { lpSet: new Set<string>(), volume: 0 };
      e.lpSet.add(a.lpId);
      e.volume += a.volume;
      map.set(c, e);
    }
    return [...map.entries()]
      .map(([corridor, v]) => ({
        corridor,
        lpCount: v.lpSet.size,
        uniqueLPs: v.lpSet.size,
        volume: round(v.volume, 2),
      }))
      .sort((a, b) => b.volume - a.volume);
  }

  /** Active LP count in `range`. */
  getActiveLPCount(range: TimeRange): number {
    const set = new Set<string>();
    for (const a of this.activities) {
      if (!inRange(a.ts, range)) continue;
      if (a.type === 'settlement' || a.type === 'activate' || a.type === 'stake') {
        set.add(a.lpId);
      }
    }
    return set.size;
  }

  /**
   * Subscribe to kernel events. Auto-ingests:
   *   - `treasury.lp_settlement_recorded` → settlement activity
   *   - `lp.invited`, `lp.activate`, `lp.pause`, `lp.resume`, `lp.suspend`,
   *     `lp.slash`, `lp.exit` → corresponding activity
   */
  subscribe(eventBus: EventEngine = eventEngine): () => void {
    const handler = (event: { type: string; payload: Record<string, unknown>; ts: number }) => {
      try {
        const p = event.payload as {
          lpId?: string;
          corridor?: string;
          volume?: number;
          fee?: number;
          cost?: number;
          reason?: string;
        };
        const lpId = p.lpId;
        if (!lpId) return;
        if (event.type === 'treasury.lp_settlement_recorded') {
          this.recordLPActivity(lpId, {
            type: 'settlement',
            corridor: p.corridor,
            volume: p.volume,
            fee: p.fee,
            ts: event.ts,
          });
          return;
        }
        if (event.type === 'lp.invited' || event.type === 'lp.apply') return;
        const typeMap: Record<string, LPActivityType> = {
          'lp.activate': 'activate',
          'lp.pause': 'pause',
          'lp.resume': 'resume',
          'lp.suspend': 'suspend',
          'lp.slash': 'slash',
          'lp.exit': 'exit',
          'lp.drain': 'exit',
          'lp.request_withdraw': 'exit',
          'lp.reactivate': 'activate',
          'lp.set_manual': 'pause',
          'lp.set_auto': 'resume',
        };
        const mapped = typeMap[event.type];
        if (mapped) {
          this.recordLPActivity(lpId, { type: mapped, reason: p.reason, ts: event.ts });
        }
      } catch {
        // non-invasive
      }
    };
    const off1 = eventBus.on('treasury.', handler);
    const off2 = eventBus.on('lp.', handler);
    this.unsubscribe = () => {
      off1();
      off2();
    };
    return this.unsubscribe;
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
  }

  /** Snapshot counts. */
  stats(): { activities: number; lps: number } {
    const set = new Set<string>();
    for (const a of this.activities) set.add(a.lpId);
    return { activities: this.activities.length, lps: set.size };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForLP = globalThis as unknown as {
  __PAYSWAP_LP_ANALYTICS?: LPAnalyticsService;
};

export const lpAnalytics: LPAnalyticsService =
  _globalForLP.__PAYSWAP_LP_ANALYTICS ?? new LPAnalyticsService();
if (!_globalForLP.__PAYSWAP_LP_ANALYTICS) {
  _globalForLP.__PAYSWAP_LP_ANALYTICS = lpAnalytics;
}

export type { EventEngine };
export const _dayMs = DAY_MS; // re-exported for tests
