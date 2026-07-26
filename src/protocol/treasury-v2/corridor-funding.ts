/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Corridor Funding.
 *
 * Moves reserves between corridors to keep each corridor's reserve
 * within its `[minReserve, maxReserve]` band. The corridor funding
 * service is the operational arm of the treasury: when a corridor
 * projects a shortfall (per the liquidity forecaster), the funding
 * service pulls reserves from over-reserved corridors and pushes
 * them into the under-reserved one.
 *
 * Funding movements are always backed by a reserve debit at the
 * source and a credit at the destination. The service never mints
 * or burns — it only reallocates existing reserves.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.corridor_funded`     — after a fund movement.
 *  - `treasury.corridor_defunded`   — after a defund movement.
 *  - `treasury.corridor_rebalanced` — after an auto-rebalance.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  CorridorFundingRecord,
  CorridorId,
  CorridorReserve,
  CorridorTarget,
} from './types';
import { corridorKey } from './types';

/** A liquidity network view — supply of LP liquidity per corridor. */
export interface LiquidityNetworkView {
  /** Map of corridorKey → current LP liquidity in that corridor. */
  reserves: Map<string, number>;
  /** Map of corridorKey → target corridor target. */
  targets: Map<string, CorridorTarget>;
}

/** Result of a fund/defund operation. */
export interface FundingResult {
  ok: boolean;
  reason?: string;
  record?: CorridorFundingRecord;
}

/**
 * Corridor funding service — owns per-corridor reserve allocations
 * and the funding history log.
 */
export class CorridorFundingService {
  private corridorReserves = new Map<string, CorridorReserve>();
  private targets = new Map<string, CorridorTarget>();
  private history: CorridorFundingRecord[] = [];
  /** Maximum single rebalance movement (per call). */
  private maxRebalanceMove = 1_000_000;

  /** Set the corridor target (reserve band). */
  setTarget(target: CorridorTarget): void {
    this.targets.set(corridorKey(target.corridor), target);
  }

  /** Get the corridor target (or undefined). */
  getTarget(corridor: CorridorId): CorridorTarget | undefined {
    return this.targets.get(corridorKey(corridor));
  }

  /** All configured corridor targets. */
  allTargets(): CorridorTarget[] {
    return [...this.targets.values()];
  }

  /** Set the max single rebalance movement. */
  setMaxRebalanceMove(amount: number): void {
    this.maxRebalanceMove = Math.max(0, amount);
  }

  /**
   * Fund a corridor: move `amount` from `source` into the corridor's
   * reserve. `source` is an opaque identifier (e.g. a reserve
   * account id, an LP id, "treasury") — the funding service does
   * not verify the source has the funds (that's the reserve
   * monitor's job).
   *
   * Returns a `FundingResult` with the funding record on success.
   */
  fundCorridor(corridor: CorridorId, amount: number, source: string, reason = 'manual_fund'): FundingResult {
    if (amount <= 0) {
      return { ok: false, reason: 'non_positive_amount' };
    }
    const key = corridorKey(corridor);
    const existing = this.corridorReserves.get(key);
    const currency = corridor.to; // corridor destination currency convention
    const updated: CorridorReserve = {
      corridor,
      amount: (existing?.amount ?? 0) + amount,
      currency,
      updatedAt: nowTs(),
    };
    this.corridorReserves.set(key, updated);
    const record: CorridorFundingRecord = {
      id: uid('cfund'),
      corridor,
      amount,
      direction: 'fund',
      source,
      destination: key,
      ts: nowTs(),
      reason,
    };
    this.history.push(record);
    eventEngine.emit('treasury.corridor_funded', {
      corridor: key, amount, source, reason, recordId: record.id,
      newReserve: updated.amount,
    });
    return { ok: true, record };
  }

  /**
   * Defund a corridor: move `amount` out of the corridor's reserve
   * to `destination`. Reduces the corridor's reserve. Returns
   * `ok: false` if the corridor has insufficient reserve.
   */
  defundCorridor(corridor: CorridorId, amount: number, destination: string, reason = 'manual_defund'): FundingResult {
    if (amount <= 0) {
      return { ok: false, reason: 'non_positive_amount' };
    }
    const key = corridorKey(corridor);
    const existing = this.corridorReserves.get(key);
    if (!existing || existing.amount < amount) {
      return { ok: false, reason: `insufficient_corridor_reserve:${existing?.amount ?? 0}<${amount}` };
    }
    existing.amount -= amount;
    existing.updatedAt = nowTs();
    const record: CorridorFundingRecord = {
      id: uid('cdefund'),
      corridor,
      amount,
      direction: 'defund',
      source: key,
      destination,
      ts: nowTs(),
      reason,
    };
    this.history.push(record);
    eventEngine.emit('treasury.corridor_defunded', {
      corridor: key, amount, destination, reason, recordId: record.id,
      newReserve: existing.amount,
    });
    return { ok: true, record };
  }

  /** Get the current reserve allocated to a corridor (or undefined). */
  getCorridorReserve(corridor: CorridorId): CorridorReserve | undefined {
    return this.corridorReserves.get(corridorKey(corridor));
  }

  /** All corridor reserves. */
  allCorridorReserves(): CorridorReserve[] {
    return [...this.corridorReserves.values()];
  }

  /** Funding history (optionally filtered by corridor). */
  getFundingHistory(corridor?: CorridorId): CorridorFundingRecord[] {
    if (!corridor) return [...this.history];
    const key = corridorKey(corridor);
    return this.history.filter((r) => corridorKey(r.corridor) === key);
  }

  /**
   * Auto-rebalance: scan the liquidity network for over-reserved and
   * under-reserved corridors (relative to their target bands) and
   * move reserves from over → under.
   *
   * A corridor is "under-reserved" if its reserve < `targetReserve - rebalanceThreshold`.
   * A corridor is "over-reserved" if its reserve > `targetReserve + rebalanceThreshold`.
   *
   * For each under-reserved corridor, pull from the most over-reserved
   * corridors (largest excess first) until the under-reserved corridor
   * reaches its target OR no over-reserved corridors remain.
   *
   * Returns the list of rebalance records produced.
   */
  rebalance(_liquidityNetwork: LiquidityNetworkView): CorridorFundingRecord[] {
    const moves: CorridorFundingRecord[] = [];
    const now = nowTs();

    // Compute excess / deficit per corridor (relative to target).
    interface CorridorBalance {
      corridor: CorridorId;
      current: number;
      target: number;
      threshold: number;
      excess: number; // positive = over-reserved
    }
    const balances: CorridorBalance[] = [];
    for (const target of this.targets.values()) {
      const key = corridorKey(target.corridor);
      const current = this.corridorReserves.get(key)?.amount ??
        _liquidityNetwork.reserves.get(key) ?? 0;
      const excess = current - target.targetReserve;
      balances.push({
        corridor: target.corridor,
        current,
        target: target.targetReserve,
        threshold: target.rebalanceThreshold,
        excess,
      });
    }

    // Sort: under-reserved (deficit) first by magnitude; over-reserved by excess desc.
    const underReserved = balances
      .filter((b) => b.excess < -b.threshold)
      .sort((a, b) => a.excess - b.excess); // most negative first
    const overReserved = balances
      .filter((b) => b.excess > b.threshold)
      .sort((a, b) => b.excess - a.excess); // largest excess first

    for (const under of underReserved) {
      let needed = Math.min(this.maxRebalanceMove, under.target - under.current);
      if (needed <= 0) continue;
      for (const over of overReserved) {
        if (needed <= 0) break;
        if (over.excess <= over.threshold) continue;
        const move = Math.min(needed, over.excess - over.threshold, this.maxRebalanceMove);
        if (move <= 0) continue;
        // Defund from over, fund into under.
        const defund = this.defundCorridor(over.corridor, move, corridorKey(under.corridor), 'auto_rebalance');
        if (!defund.ok) continue;
        const fund = this.fundCorridor(under.corridor, move, corridorKey(over.corridor), 'auto_rebalance');
        if (!fund.ok) {
          // Roll back the defund.
          this.fundCorridor(over.corridor, move, corridorKey(under.corridor), 'auto_rebalance_rollback');
          continue;
        }
        if (defund.record) moves.push(defund.record);
        if (fund.record) moves.push(fund.record);
        over.excess -= move;
        over.current -= move;
        under.current += move;
        under.excess += move;
        needed -= move;
      }
    }

    if (moves.length > 0) {
      eventEngine.emit('treasury.corridor_rebalanced', {
        moves: moves.length,
        totalMoved: moves
          .filter((m) => m.direction === 'fund')
          .reduce((acc, m) => acc + m.amount, 0),
        ts: now,
      });
    }
    return moves;
  }

  /** Total capital deployed across all corridors. */
  totalDeployed(): number {
    let total = 0;
    for (const r of this.corridorReserves.values()) total += r.amount;
    return total;
  }

  /** Reset all corridor funding state (history + reserves + targets). */
  reset(): void {
    this.corridorReserves.clear();
    this.targets.clear();
    this.history = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_CORRIDOR_FUNDING: CorridorFundingService | undefined;
}

export const corridorFundingService: CorridorFundingService =
  globalThis.__PAYSWAP_CORRIDOR_FUNDING ?? new CorridorFundingService();

if (!globalThis.__PAYSWAP_CORRIDOR_FUNDING) {
  globalThis.__PAYSWAP_CORRIDOR_FUNDING = corridorFundingService;
}
