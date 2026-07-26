/**
 * PaySwap Protocol — Treasury Operations Center (v2) — LP Profitability.
 *
 * Tracks per-LP / per-corridor profitability:
 *
 *   - volume   — total settlement volume routed through this LP
 *   - revenue  — fees earned by the LP (settlement fees)
 *   - costs    — capital cost (opportunity cost of committed reserves)
 *                + operational cost (opex per settlement)
 *   - pnl      — revenue - costs
 *   - margin   — pnl / revenue (0 if revenue is 0)
 *   - apy      — annualised return on committed capital:
 *                pnl * (365 * 24 * 3600 * 1000) / rangeMs / capitalCommitted
 *
 * The service keeps an append-only log of settlement records. The
 * `getProfitability` / `getCorridorProfitability` / `getTopLPs` /
 * `getUnderperformingLPs` queries aggregate over a time range
 * (default: last 30 days).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.lp_settlement_recorded` — after each settlement.
 *  - `treasury.lp_underperforming`     — when an LP falls below threshold.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  CorridorId,
  CorridorYieldSummary,
  LPProfitability,
  LPSettlementRecord,
  TimeRange,
} from './types';
import { corridorKey } from './types';

/** Re-export `TimeRange` for convenience. */
export type { TimeRange } from './types';

/** Default range: last 30 days. */
export const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Default cost-of-capital (8% APR). */
export const DEFAULT_COST_OF_CAPITAL_APR = 0.08;

/** Default opex per settlement. */
export const DEFAULT_OPEX_PER_SETTLEMENT = 0.10;

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Sort key for `getTopLPs()`. */
export type LPSortKey = 'volume' | 'pnl' | 'apy';

/**
 * LP profitability service — owns the per-LP settlement log and
 * computes profitability metrics on demand.
 */
export class LPProfitabilityService {
  private records: LPSettlementRecord[] = [];
  /** Per-LP committed capital (used for APY computation). */
  private committedCapital = new Map<string, number>();
  private costOfCapitalApr = DEFAULT_COST_OF_CAPITAL_APR;
  private opexPerSettlement = DEFAULT_OPEX_PER_SETTLEMENT;

  /** Configure the cost-of-capital APR. */
  setCostOfCapitalApr(apr: number): void {
    this.costOfCapitalApr = Math.max(0, apr);
  }

  /** Configure the per-settlement opex. */
  setOpexPerSettlement(amount: number): void {
    this.opexPerSettlement = Math.max(0, amount);
  }

  /** Set an LP's committed capital (for APY computation). */
  setCommittedCapital(lpId: string, amount: number): void {
    this.committedCapital.set(lpId, Math.max(0, amount));
  }

  /** Get an LP's committed capital. */
  getCommittedCapital(lpId: string): number {
    return this.committedCapital.get(lpId) ?? 0;
  }

  /**
   * Record a settlement for an LP.
   *
   *  - `volume` — settlement volume (in destination currency units).
   *  - `fee`    — fee earned by the LP for this settlement.
   *  - `cost`   — optional explicit cost (defaults to opex per settlement).
   */
  recordSettlement(
    lpId: string,
    corridor: CorridorId,
    volume: number,
    fee: number,
    cost?: number,
    ts: number = nowTs(),
  ): LPSettlementRecord {
    const record: LPSettlementRecord = {
      id: uid('lpset'),
      lpId,
      corridor,
      volume,
      fee,
      cost: cost ?? this.opexPerSettlement,
      ts,
    };
    this.records.push(record);
    eventEngine.emit('treasury.lp_settlement_recorded', {
      lpId,
      corridor: corridorKey(corridor),
      volume,
      fee,
      cost: record.cost,
      recordId: record.id,
    });
    return record;
  }

  /** All settlement records (optionally filtered by LP). */
  getRecords(lpId?: string): LPSettlementRecord[] {
    if (!lpId) return [...this.records];
    return this.records.filter((r) => r.lpId === lpId);
  }

  /** Default time range: last `DEFAULT_RANGE_MS` ms. */
  private defaultRange(): TimeRange {
    const to = nowTs();
    return { fromTs: to - DEFAULT_RANGE_MS, toTs: to };
  }

  /**
   * Compute profitability for an LP (optionally filtered by corridor
   * via the `corridor` parameter on each record; this method
   * aggregates across all corridors the LP serves).
   */
  getProfitability(lpId: string, range?: TimeRange): LPProfitability {
    const r = range ?? this.defaultRange();
    const records = this.records.filter(
      (rec) => rec.lpId === lpId && rec.ts >= r.fromTs && rec.ts < r.toTs,
    );
    return this.aggregate(lpId, undefined, records, r);
  }

  /** Profitability for a single corridor (aggregated across all LPs). */
  getCorridorProfitability(corridor: CorridorId, range?: TimeRange): LPProfitability {
    const r = range ?? this.defaultRange();
    const records = this.records.filter(
      (rec) => corridorKey(rec.corridor) === corridorKey(corridor) && rec.ts >= r.fromTs && rec.ts < r.toTs,
    );
    return this.aggregate('*', corridor, records, r);
  }

  /** Per-LP profitability for a specific corridor. */
  getLPProfitabilityInCorridor(lpId: string, corridor: CorridorId, range?: TimeRange): LPProfitability {
    const r = range ?? this.defaultRange();
    const records = this.records.filter(
      (rec) => rec.lpId === lpId && corridorKey(rec.corridor) === corridorKey(corridor) && rec.ts >= r.fromTs && rec.ts < r.toTs,
    );
    return this.aggregate(lpId, corridor, records, r);
  }

  /** Top-N LPs by the chosen sort key. */
  getTopLPs(by: LPSortKey = 'volume', limit = 10, range?: TimeRange): LPProfitability[] {
    const r = range ?? this.defaultRange();
    const lpIds = new Set(this.records
      .filter((rec) => rec.ts >= r.fromTs && rec.ts < r.toTs)
      .map((rec) => rec.lpId));
    const profitability = [...lpIds].map((lpId) => this.getProfitability(lpId, r));
    profitability.sort((a, b) => {
      if (by === 'volume') return b.volume - a.volume;
      if (by === 'pnl') return b.pnl - a.pnl;
      return b.apy - a.apy;
    });
    return profitability.slice(0, Math.max(0, limit));
  }

  /**
   * LPs whose margin is below `threshold` (default -0.05 = -5%).
   * Emits a `treasury.lp_underperforming` event for each.
   */
  getUnderperformingLPs(threshold = -0.05, range?: TimeRange): LPProfitability[] {
    const r = range ?? this.defaultRange();
    const top = this.getTopLPs('volume', Number.MAX_SAFE_INTEGER, r);
    const under = top.filter((p) => p.margin < threshold);
    for (const u of under) {
      eventEngine.emit('treasury.lp_underperforming', {
        lpId: u.lpId,
        corridor: corridorKey(u.corridor),
        margin: u.margin,
        pnl: u.pnl,
        threshold,
      });
    }
    return under;
  }

  /** Yield summary per corridor (APR = revenue / deployed capital over range, annualised). */
  getCorridorYields(range?: TimeRange): CorridorYieldSummary[] {
    const r = range ?? this.defaultRange();
    const rangeMs = Math.max(1, r.toTs - r.fromTs);
    const byCorridor = new Map<string, { corridor: CorridorId; volume: number; revenue: number; costs: number }>();
    for (const rec of this.records) {
      if (rec.ts < r.fromTs || rec.ts >= r.toTs) continue;
      const key = corridorKey(rec.corridor);
      const existing = byCorridor.get(key) ?? { corridor: rec.corridor, volume: 0, revenue: 0, costs: 0 };
      existing.volume += rec.volume;
      existing.revenue += rec.fee;
      existing.costs += rec.cost;
      byCorridor.set(key, existing);
    }
    const out: CorridorYieldSummary[] = [];
    for (const v of byCorridor.values()) {
      // APR = revenue annualised / deployed capital. We don't track
      // deployed capital per corridor here, so we use volume as a
      // proxy denominator (revenue / volume) annualised by the
      // range ratio. This gives a fee-bps-style APR.
      const apr = v.volume > 0 ? (v.revenue / v.volume) * (MS_PER_YEAR / rangeMs) : 0;
      out.push({
        corridor: v.corridor,
        apr,
        volume: v.volume,
        revenue: v.revenue,
        costs: v.costs,
      });
    }
    return out;
  }

  /**
   * Aggregate a list of settlement records into a single
   * `LPProfitability` snapshot.
   */
  private aggregate(
    lpId: string,
    corridor: CorridorId | undefined,
    records: LPSettlementRecord[],
    range: TimeRange,
  ): LPProfitability {
    const volume = records.reduce((acc, r) => acc + r.volume, 0);
    const revenue = records.reduce((acc, r) => acc + r.fee, 0);
    const baseCosts = records.reduce((acc, r) => acc + r.cost, 0);
    const capitalCommitted = lpId === '*' ? 0 : this.committedCapital.get(lpId) ?? 0;
    const rangeMs = Math.max(1, range.toTs - range.fromTs);
    // Capital cost = committed capital * APR * (rangeMs / year).
    const capitalCost = capitalCommitted * this.costOfCapitalApr * (rangeMs / MS_PER_YEAR);
    const costs = baseCosts + capitalCost;
    const pnl = revenue - costs;
    const margin = revenue > 0 ? pnl / revenue : 0;
    // APY = pnl annualised / capital committed.
    const apy = capitalCommitted > 0
      ? (pnl * (MS_PER_YEAR / rangeMs)) / capitalCommitted
      : 0;
    return {
      lpId,
      corridor: corridor ?? { from: '*', to: '*' },
      volume,
      revenue,
      costs,
      pnl,
      margin,
      apy,
      capitalCommitted,
      settlementCount: records.length,
      fromTs: range.fromTs,
      toTs: range.toTs,
    };
  }

  /** Reset all settlement records. */
  reset(): void {
    this.records = [];
    this.committedCapital.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_LP_PROFITABILITY: LPProfitabilityService | undefined;
}

export const lpProfitabilityService: LPProfitabilityService =
  globalThis.__PAYSWAP_LP_PROFITABILITY ?? new LPProfitabilityService();

if (!globalThis.__PAYSWAP_LP_PROFITABILITY) {
  globalThis.__PAYSWAP_LP_PROFITABILITY = lpProfitabilityService;
}
