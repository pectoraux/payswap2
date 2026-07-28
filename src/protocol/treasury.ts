/**
 * PaySwap Protocol — Treasury Module (v1).
 *
 * The treasury is autonomous but never free liquidity. It manages:
 *   - Reserve health (replenish, rebalance)
 *   - Stablecoin conversion (only when economically justified)
 *   - LP liquidity borrowing
 *   - Withdrawal position purchases
 *
 * Treasury recommendations are produced by the Treasury AI, but execution
 * requires protocol approval (no autonomous balance changes).
 *
 * TODO(HARDEN): This is the v1 treasury module (180 lines). The richer
 * implementation lives in `src/protocol/treasury-v2/` (16 sub-engines, ~4961
 * lines, used by `/api/treasury/freeze` + `/api/treasury/rebalance`). This v1
 * is still used by 4 callers (`/api/treasury/status`, `/api/protocol/health`,
 * `kernel/simulation.ts`, `protocol/ops/dashboards.ts`). Migrate those 4
 * callers to v2 then delete this file. Tracked by HARDEN-1 audit (priority
 * fix #6 / treasury consolidation).
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export interface TreasuryPosition {
  currency: string;
  stablecoinBalance: number;
  emergencyBalance: number;
  fiatBalance: number;
  totalReserves: number;
}

export interface TreasuryRecommendation {
  id: string;
  action: TreasuryAction;
  rationale: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedImpact: string;
  amount?: number;
  currency?: string;
  sourceCountry?: string;
  targetCountry?: string;
  createdAt: number;
  executedAt: number | null;
}

export type TreasuryAction =
  | 'replenish_reserve'
  | 'rebalance_reserves'
  | 'convert_stablecoin'
  | 'borrow_lp_liquidity'
  | 'purchase_withdrawal_position'
  | 'hold'
  | 'alert_low_reserve'
  | 'alert_emergency';

export class Treasury {
  private positions: Map<string, TreasuryPosition> = new Map();
  private recommendations: Map<string, TreasuryRecommendation> = new Map();

  /** Initialize treasury position for a currency. */
  initPosition(currency: string, stablecoin: number, emergency: number, fiat: number = 0): void {
    this.positions.set(currency, {
      currency, stablecoinBalance: stablecoin, emergencyBalance: emergency,
      fiatBalance: fiat, totalReserves: stablecoin + emergency + fiat,
    });
  }

  /** Get current position. */
  getPosition(currency: string): TreasuryPosition | undefined { return this.positions.get(currency); }

  /** Convert stablecoin to fiat (only when economically justified). */
  convertStablecoin(currency: string, amount: number, reason: string): boolean {
    const pos = this.positions.get(currency);
    if (!pos || pos.stablecoinBalance < amount) return false;
    pos.stablecoinBalance = round(pos.stablecoinBalance - amount, 6);
    pos.fiatBalance = round(pos.fiatBalance + amount, 6);
    pos.totalReserves = round(pos.stablecoinBalance + pos.emergencyBalance + pos.fiatBalance, 6);
    eventEngine.emit('treasury.converted', { currency, amount, reason, newStablecoin: pos.stablecoinBalance }, 0);
    return true;
  }

  /** Borrow LP liquidity (treasury borrows from LPs). */
  borrowLpLiquidity(currency: string, amount: number, lpId: string, interestRate: number): boolean {
    const pos = this.positions.get(currency);
    if (!pos) return false;
    pos.fiatBalance = round(pos.fiatBalance + amount, 6);
    pos.totalReserves = round(pos.stablecoinBalance + pos.emergencyBalance + pos.fiatBalance, 6);
    eventEngine.emit('treasury.borrowed', { currency, amount, lpId, interestRate }, 0);
    return true;
  }

  /** Rebalance reserves between countries. */
  rebalance(fromCurrency: string, toCurrency: string, amount: number): boolean {
    const from = this.positions.get(fromCurrency);
    const to = this.positions.get(toCurrency);
    if (!from || !to || from.fiatBalance < amount) return false;
    from.fiatBalance = round(from.fiatBalance - amount, 6);
    to.fiatBalance = round(to.fiatBalance + amount, 6);
    from.totalReserves = round(from.stablecoinBalance + from.emergencyBalance + from.fiatBalance, 6);
    to.totalReserves = round(to.stablecoinBalance + to.emergencyBalance + to.fiatBalance, 6);
    eventEngine.emit('treasury.rebalanced', { fromCurrency, toCurrency, amount }, 0);
    return true;
  }

  /** Generate treasury recommendations based on reserve health. */
  generateRecommendations(
    reserves: { country: string; currency: string; available: number; minThreshold: number }[],
  ): TreasuryRecommendation[] {
    const recs: TreasuryRecommendation[] = [];

    for (const r of reserves) {
      const headroom = r.available - r.minThreshold;
      const utilization = r.available > 0 ? 1 - headroom / r.available : 1;

      if (r.available < r.minThreshold) {
        recs.push({
          id: uid('trec'), action: 'alert_emergency',
          rationale: `${r.country} reserve BELOW threshold: ${r.available} < ${r.minThreshold}`,
          priority: 'critical', estimatedImpact: `Immediate replenishment needed`,
          amount: r.minThreshold - r.available + r.minThreshold * 0.2, currency: r.currency,
          sourceCountry: r.country, createdAt: Date.now(), executedAt: null,
        });
      } else if (utilization > 0.7) {
        recs.push({
          id: uid('trec'), action: 'replenish_reserve',
          rationale: `${r.country} reserve utilization ${round(utilization * 100, 1)}% — above 70% threshold`,
          priority: 'high', estimatedImpact: `+${round(r.minThreshold * 0.5, 0)} ${r.currency} buffer`,
          amount: r.minThreshold * 0.5, currency: r.currency,
          sourceCountry: r.country, createdAt: Date.now(), executedAt: null,
        });
      } else if (utilization > 0.5) {
        recs.push({
          id: uid('trec'), action: 'alert_low_reserve',
          rationale: `${r.country} reserve utilization ${round(utilization * 100, 1)}%`,
          priority: 'medium', estimatedImpact: 'Monitor closely',
          currency: r.currency, sourceCountry: r.country, createdAt: Date.now(), executedAt: null,
        });
      }

      // Check if stablecoin conversion is economically justified
      const pos = this.getPosition(r.currency);
      if (pos && pos.stablecoinBalance > r.available * 3) {
        recs.push({
          id: uid('trec'), action: 'convert_stablecoin',
          rationale: `Stablecoin excess (${pos.stablecoinBalance}) vs reserve (${r.available}) — conversion economically justified`,
          priority: 'low', estimatedImpact: `Convert ${round(pos.stablecoinBalance * 0.2, 0)} ${r.currency}`,
          amount: pos.stablecoinBalance * 0.2, currency: r.currency,
          sourceCountry: r.country, createdAt: Date.now(), executedAt: null,
        });
      }
    }

    // Register recommendations
    for (const rec of recs) {
      this.recommendations.set(rec.id, rec);
    }
    return recs;
  }

  /** Execute a recommendation. */
  executeRecommendation(recId: string): boolean {
    const rec = this.recommendations.get(recId);
    if (!rec || rec.executedAt !== null) return false;
    rec.executedAt = Date.now();

    switch (rec.action) {
      case 'convert_stablecoin':
        if (rec.currency && rec.amount) this.convertStablecoin(rec.currency, rec.amount, rec.rationale);
        break;
      case 'rebalance_reserves':
        if (rec.sourceCountry && rec.currency && rec.amount) this.rebalance(rec.currency, rec.currency, rec.amount);
        break;
      // Other actions require external execution (LP borrowing, etc.)
    }

    eventEngine.emit('treasury.recommendation_executed', { recId, action: rec.action }, 0);
    return true;
  }

  allRecommendations(): TreasuryRecommendation[] { return [...this.recommendations.values()]; }
  pendingRecommendations(): TreasuryRecommendation[] { return this.allRecommendations().filter((r) => r.executedAt === null); }

  allPositions(): TreasuryPosition[] { return [...this.positions.values()]; }

  reset(): void { this.positions.clear(); this.recommendations.clear(); }
}

export const treasury = new Treasury();
