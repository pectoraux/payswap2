/**
 * PaySwap Protocol — Observability — Business KPI Tracker.
 *
 * Tracks the canonical PaySwap business KPI set: payment/payout volume,
 * active merchants / LPs, settlement + payout success rates, revenue,
 * refund rate, twin-token supply, reserve-backing ratio, connector uptime.
 *
 * Each KPI carries:
 *   - value (current)
 *   - unit (USD, count, %, ms, ratio, tokens)
 *   - period (realtime / hourly / daily / weekly / monthly)
 *   - trend (up / down / flat — vs. previous recording)
 *   - changePct (signed % change vs. previous recording)
 *   - target + warning/critical thresholds
 *   - status (on_track / warning / critical — computed from thresholds)
 *   - history (rolling window of {ts, value} points)
 *
 * Direction matters: a 'higher_better' KPI goes critical when value drops
 * below the critical threshold; a 'lower_better' KPI goes critical when value
 * rises above it.
 *
 * The kernel is FROZEN — this module imports only `round`, `nowTs` from
 * `@/kernel/support`. No kernel files are modified.
 */
import { round, nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KPITrend = 'up' | 'down' | 'flat';
export type KPIStatus = 'on_track' | 'warning' | 'critical';
export type KPIPeriod = 'realtime' | 'hourly' | 'daily' | 'weekly' | 'monthly';
export type KPICategory =
  | 'volume'
  | 'engagement'
  | 'reliability'
  | 'performance'
  | 'financial';

export interface BusinessKPI {
  name: string;
  value: number;
  unit: string;
  period: KPIPeriod;
  trend: KPITrend;
  changePct: number;
  target?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  status: KPIStatus;
  category: string;
  description: string;
  lastUpdated: number;
  history: { ts: number; value: number }[];
}

/** Static spec for a tracked KPI — declared once at tracker construction. */
export interface KPISpec {
  name: string;
  unit: string;
  category: KPICategory;
  description: string;
  target?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  /** 'higher_better' = up is good; 'lower_better' = down is good. */
  direction: 'higher_better' | 'lower_better';
  period?: KPIPeriod;
}

// ---------------------------------------------------------------------------
// Default KPI specifications — the canonical PaySwap business KPI set.
// ---------------------------------------------------------------------------

export const DEFAULT_KPI_SPECS: Record<string, KPISpec> = {
  total_payment_volume: {
    name: 'total_payment_volume',
    unit: 'USD',
    category: 'volume',
    description: 'Total payment volume processed',
    target: 1_000_000,
    warningThreshold: 500_000,
    criticalThreshold: 100_000,
    direction: 'higher_better',
    period: 'daily',
  },
  total_payout_volume: {
    name: 'total_payout_volume',
    unit: 'USD',
    category: 'volume',
    description: 'Total payout volume processed',
    target: 500_000,
    warningThreshold: 200_000,
    criticalThreshold: 50_000,
    direction: 'higher_better',
    period: 'daily',
  },
  active_merchants: {
    name: 'active_merchants',
    unit: 'count',
    category: 'engagement',
    description: 'Number of active merchants',
    target: 100,
    warningThreshold: 50,
    criticalThreshold: 10,
    direction: 'higher_better',
    period: 'daily',
  },
  active_lps: {
    name: 'active_lps',
    unit: 'count',
    category: 'engagement',
    description: 'Number of active liquidity providers',
    target: 20,
    warningThreshold: 10,
    criticalThreshold: 3,
    direction: 'higher_better',
    period: 'daily',
  },
  settlement_success_rate: {
    name: 'settlement_success_rate',
    unit: '%',
    category: 'reliability',
    description: 'Settlement success rate',
    target: 99,
    warningThreshold: 95,
    criticalThreshold: 90,
    direction: 'higher_better',
    period: 'daily',
  },
  avg_settlement_time: {
    name: 'avg_settlement_time',
    unit: 'ms',
    category: 'performance',
    description: 'Average settlement time',
    target: 5_000,
    warningThreshold: 15_000,
    criticalThreshold: 60_000,
    direction: 'lower_better',
    period: 'daily',
  },
  payout_success_rate: {
    name: 'payout_success_rate',
    unit: '%',
    category: 'reliability',
    description: 'Payout success rate',
    target: 99,
    warningThreshold: 95,
    criticalThreshold: 90,
    direction: 'higher_better',
    period: 'daily',
  },
  revenue: {
    name: 'revenue',
    unit: 'USD',
    category: 'financial',
    description: 'Revenue from fees',
    target: 50_000,
    warningThreshold: 20_000,
    criticalThreshold: 5_000,
    direction: 'higher_better',
    period: 'monthly',
  },
  refund_rate: {
    name: 'refund_rate',
    unit: '%',
    category: 'financial',
    description: 'Refund rate (refunds / transactions)',
    target: 1,
    warningThreshold: 3,
    criticalThreshold: 5,
    direction: 'lower_better',
    period: 'daily',
  },
  twin_token_supply: {
    name: 'twin_token_supply',
    unit: 'tokens',
    category: 'financial',
    description: 'Total Twin Token supply in circulation',
    target: 1_000_000,
    warningThreshold: 100_000,
    criticalThreshold: 10_000,
    direction: 'higher_better',
    period: 'realtime',
  },
  reserve_backing_ratio: {
    name: 'reserve_backing_ratio',
    unit: 'ratio',
    category: 'financial',
    description: 'Reserve backing ratio (reserves / twin supply)',
    target: 1.0,
    warningThreshold: 0.99,
    criticalThreshold: 0.95,
    direction: 'higher_better',
    period: 'realtime',
  },
  connector_uptime: {
    name: 'connector_uptime',
    unit: '%',
    category: 'reliability',
    description: 'Average connector uptime',
    target: 99.5,
    warningThreshold: 99,
    criticalThreshold: 95,
    direction: 'higher_better',
    period: 'daily',
  },
};

// ---------------------------------------------------------------------------
// KPI Tracker
// ---------------------------------------------------------------------------

/**
 * KPI tracker. Holds the current value of every KPI plus a rolling history.
 * `record(name, value)` updates the KPI, recomputes trend + status, and
 * appends to history. Callers (dashboards, exporters) read via `getKPI`,
 * `getAllKPIs`, `getKPIsByCategory`.
 */
export class KPITracker {
  private readonly kpis = new Map<string, BusinessKPI>();
  private readonly specs: Record<string, KPISpec>;
  private readonly maxHistory: number;

  constructor(specs: Record<string, KPISpec> = DEFAULT_KPI_SPECS, maxHistory = 1440) {
    this.specs = specs;
    this.maxHistory = maxHistory;
    for (const spec of Object.values(this.specs)) {
      this.kpis.set(spec.name, this.zeroKPI(spec));
    }
  }

  private zeroKPI(spec: KPISpec): BusinessKPI {
    return {
      name: spec.name,
      value: 0,
      unit: spec.unit,
      period: spec.period ?? 'realtime',
      trend: 'flat',
      changePct: 0,
      target: spec.target,
      warningThreshold: spec.warningThreshold,
      criticalThreshold: spec.criticalThreshold,
      status: 'on_track',
      category: spec.category,
      description: spec.description,
      lastUpdated: nowTs(),
      history: [],
    };
  }

  /** Record a new value for `name`. Creates an ad-hoc KPI if not pre-tracked. */
  record(name: string, value: number, unit?: string): void {
    const safeValue = Number.isFinite(value) ? value : 0;
    const spec = this.specs[name];
    const existing = this.kpis.get(name);
    const prev = existing?.value ?? 0;
    const changePct =
      prev !== 0 ? round(((safeValue - prev) / Math.abs(prev)) * 100, 4) : 0;
    const trend: KPITrend = changePct > 1 ? 'up' : changePct < -1 ? 'down' : 'flat';
    const history = [...(existing?.history ?? []), { ts: nowTs(), value: round(safeValue, 6) }].slice(
      -this.maxHistory,
    );

    if (spec) {
      this.kpis.set(name, {
        name,
        value: round(safeValue, 6),
        unit: spec.unit,
        period: spec.period ?? 'realtime',
        trend,
        changePct,
        target: spec.target,
        warningThreshold: spec.warningThreshold,
        criticalThreshold: spec.criticalThreshold,
        status: this.computeStatus(spec, safeValue),
        category: spec.category,
        description: spec.description,
        lastUpdated: nowTs(),
        history,
      });
      return;
    }

    // Ad-hoc KPI (no spec) — no thresholds, always 'on_track'.
    this.kpis.set(name, {
      name,
      value: round(safeValue, 6),
      unit: unit ?? '',
      period: 'realtime',
      trend,
      changePct,
      status: 'on_track',
      category: 'general',
      description: '',
      lastUpdated: nowTs(),
      history,
    });
  }

  /** Compute the status of a KPI given its spec + value. */
  private computeStatus(spec: KPISpec, value: number): KPIStatus {
    const { warningThreshold, criticalThreshold, direction } = spec;
    if (direction === 'higher_better') {
      if (criticalThreshold !== undefined && value < criticalThreshold) return 'critical';
      if (warningThreshold !== undefined && value < warningThreshold) return 'warning';
      return 'on_track';
    }
    // lower_better
    if (criticalThreshold !== undefined && value > criticalThreshold) return 'critical';
    if (warningThreshold !== undefined && value > warningThreshold) return 'warning';
    return 'on_track';
  }

  /** Fetch a single KPI by name. */
  getKPI(name: string): BusinessKPI | undefined {
    return this.kpis.get(name);
  }

  /** Fetch every tracked KPI. */
  getAllKPIs(): BusinessKPI[] {
    return [...this.kpis.values()];
  }

  /** Fetch KPIs in a given category (volume, engagement, reliability, performance, financial). */
  getKPIsByCategory(category: string): BusinessKPI[] {
    return this.getAllKPIs().filter((k) => k.category === category);
  }

  /** KPIs whose status is warning or critical. */
  getAlerts(): BusinessKPI[] {
    return this.getAllKPIs().filter((k) => k.status === 'warning' || k.status === 'critical');
  }

  /** Reset every tracked KPI to zero (testing only). */
  reset(): void {
    for (const spec of Object.values(this.specs)) {
      this.kpis.set(spec.name, this.zeroKPI(spec));
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForKPI = globalThis as unknown as { __PAYSWAP_KPI_TRACKER?: KPITracker };

export const kpiTracker: KPITracker =
  _globalForKPI.__PAYSWAP_KPI_TRACKER ?? new KPITracker();
if (!_globalForKPI.__PAYSWAP_KPI_TRACKER) {
  _globalForKPI.__PAYSWAP_KPI_TRACKER = kpiTracker;
}
