/**
 * Liquidity Registry — in-process store of LPRecords.
 *
 * The registry is the single source of truth for LP state in the network.
 * Capacity numbers (capacity, availableCapacity, reservedCapacity) are mutated
 * ONLY by capacity.ts (reserve/release/consume/replenish) — the registry
 * exposes them for read but never decrements them directly.
 */
import type { Corridor } from './types';
import { corridorKey, type LPId, type LPNetworkState, type LPRecord } from './types';

/**
 * Patch type for `update()`. All fields are optional except none — the patch
 * is applied as a shallow merge. To mutate per-corridor capacity fields, the
 * caller should pass the entire `capacity` / `availableCapacity` /
 * `reservedCapacity` record (the registry does NOT deep-merge).
 */
export type LPRecordPatch = Partial<Omit<LPRecord, 'id'>>;

/**
 * Parameters for `register()` — what the caller supplies. The registry fills
 * in derived defaults (availableCapacity = capacity, reservedCapacity = 0,
 * joinedAt = now, lastSettlementTs = null) so callers don't have to.
 */
export interface RegisterLPParams {
  id: LPId;
  name: string;
  country: string;
  corridors: Corridor[];
  state?: LPNetworkState;
  /** Per-corridor capacity, in `fromCurrency` units. */
  capacity: Record<string, number>;
  reputation?: number;
  tier?: string;
  feeBps?: number;
  settlementSpeedMs?: number;
  historicalSuccessRate?: number;
  totalVolume?: number;
  totalSettlements?: number;
  lastSettlementTs?: number | null;
  joinedAt?: number;
}

export class LiquidityRegistry {
  private lps: Map<LPId, LPRecord> = new Map();

  /**
   * Register an LP. If the id already exists, the existing record is
   * overwritten (caller's responsibility — typically `update()` is what you
   * want for existing LPs).
   */
  register(lp: RegisterLPParams): LPRecord {
    const now = Date.now();
    const record: LPRecord = {
      id: lp.id,
      name: lp.name,
      country: lp.country,
      corridors: [...lp.corridors],
      state: lp.state ?? 'active',
      capacity: { ...lp.capacity },
      availableCapacity: { ...lp.capacity },
      reservedCapacity: Object.fromEntries(Object.keys(lp.capacity).map((k) => [k, 0])),
      reputation: lp.reputation ?? 0.5,
      tier: lp.tier ?? 'standard',
      feeBps: lp.feeBps ?? 80,
      settlementSpeedMs: lp.settlementSpeedMs ?? 30_000,
      historicalSuccessRate: lp.historicalSuccessRate ?? 0.95,
      totalVolume: lp.totalVolume ?? 0,
      totalSettlements: lp.totalSettlements ?? 0,
      lastSettlementTs: lp.lastSettlementTs ?? null,
      joinedAt: lp.joinedAt ?? now,
    };
    this.lps.set(lp.id, record);
    return record;
  }

  /** Get an LP by id, or undefined. */
  get(id: LPId): LPRecord | undefined {
    return this.lps.get(id);
  }

  /** All LPs (any state). */
  all(): LPRecord[] {
    return [...this.lps.values()];
  }

  /**
   * All active LPs. If `corridor` is supplied, filtered to LPs that serve
   * that corridor. (Routing NEVER selects paused/draining LPs — invariant 4.)
   */
  activeLPs(corridor?: Corridor): LPRecord[] {
    const key = corridor ? corridorKey(corridor) : null;
    return this.all().filter((lp) => {
      if (lp.state !== 'active') return false;
      if (key === null) return true;
      return lp.corridors.some((c) => corridorKey(c) === key);
    });
  }

  /** LPs serving a specific corridor (any state). */
  byCorridor(corridor: Corridor): LPRecord[] {
    const key = corridorKey(corridor);
    return this.all().filter((lp) => lp.corridors.some((c) => corridorKey(c) === key));
  }

  /**
   * Apply a shallow patch to an LP record. Returns the updated record, or null
   * if the LP doesn't exist.
   *
   * NOTE: For per-corridor capacity mutations, prefer capacity.ts methods
   * (reserve/release/consume/replenish) which atomically update all three
   * capacity counters. This `update()` is for non-capacity fields (state,
   * reputation, tier, feeBps, settlementSpeedMs, …).
   */
  update(id: LPId, patch: LPRecordPatch): LPRecord | null {
    const lp = this.lps.get(id);
    if (!lp) return null;
    Object.assign(lp, patch);
    return lp;
  }

  /** Remove an LP from the registry. */
  remove(id: LPId): boolean {
    return this.lps.delete(id);
  }

  /** Clear all LPs (test helper). */
  reset(): void {
    this.lps.clear();
  }
}

/** Singleton liquidity registry. */
export const liquidityRegistry = new LiquidityRegistry();
