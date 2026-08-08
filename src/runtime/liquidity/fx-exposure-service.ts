/**
 * F3: FX Exposure Service — tracks open FX positions and enforces limits.
 *
 * Decision: PaySwap carries FX risk between quote and settlement.
 * An open FX position exists when a quote is accepted but the
 * counter-leg hasn't settled yet. This service:
 *   1. Records open positions when a cross-currency payment starts
 *   2. Closes positions when the counter-leg settles
 *   3. Enforces a per-corridor exposure limit
 *   4. Blocks new plans when the limit is breached
 *
 * The limit is a treasury control — if breached, new cross-currency
 * plans are rejected until existing positions close or the treasury
 * hedges (manual action).
 */

export interface FxPosition {
  id: string;
  corridor: string;           // e.g. 'GHS:NGN'
  fromCurrency: string;
  toCurrency: string;
  rate: number;               // locked rate
  sourceAmount: number;       // amount in source currency
  destinationAmount: number;  // amount in destination currency
  openedAt: number;
  closedAt: number | null;
  status: 'open' | 'closed' | 'expired';
  paymentId: string;
}

export interface FxExposureLimit {
  corridor: string;
  maxOpenExposure: number;    // max total open source amount
  currentExposure: number;    // sum of open positions' source amounts
}

export class FxExposureService {
  private positions = new Map<string, FxPosition>();
  private limits = new Map<string, FxExposureLimit>();
  private positionCounter = 0;

  /** Set the exposure limit for a corridor. */
  setLimit(corridor: string, maxOpenExposure: number): void {
    const key = this.corridorKey(corridor);
    const existing = this.limits.get(key);
    this.limits.set(key, {
      corridor: key,
      maxOpenExposure,
      currentExposure: existing?.currentExposure ?? 0,
    });
  }

  /**
   * Open a new FX position. Returns null if the corridor limit is breached.
   * This is the gate: if it returns null, the plan should not proceed.
   */
  openPosition(params: {
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    sourceAmount: number;
    destinationAmount: number;
    paymentId: string;
  }): FxPosition | null {
    const corridor = this.corridorKey(`${params.fromCurrency}:${params.toCurrency}`);
    const limit = this.limits.get(corridor);

    // Check limit
    if (limit && limit.currentExposure + params.sourceAmount > limit.maxOpenExposure) {
      return null; // Limit breached — plan should not proceed
    }

    const id = `fxp_${++this.positionCounter}`;
    const position: FxPosition = {
      id,
      corridor,
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      rate: params.rate,
      sourceAmount: params.sourceAmount,
      destinationAmount: params.destinationAmount,
      openedAt: Date.now(),
      closedAt: null,
      status: 'open',
      paymentId: params.paymentId,
    };
    this.positions.set(id, position);

    // Update exposure
    if (limit) {
      limit.currentExposure += params.sourceAmount;
    } else {
      // Auto-create a default limit (no limit = unlimited, but track exposure)
      this.limits.set(corridor, {
        corridor,
        maxOpenExposure: Infinity,
        currentExposure: params.sourceAmount,
      });
    }

    return position;
  }

  /** Close a position when the counter-leg settles. */
  closePosition(positionId: string): FxPosition | null {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'open') return null;

    position.status = 'closed';
    position.closedAt = Date.now();

    // Reduce exposure
    const limit = this.limits.get(position.corridor);
    if (limit) {
      limit.currentExposure = Math.max(0, limit.currentExposure - position.sourceAmount);
    }

    return position;
  }

  /** Get current open exposure for a corridor. */
  getExposure(fromCurrency: string, toCurrency: string): number {
    const corridor = this.corridorKey(`${fromCurrency}:${toCurrency}`);
    return this.limits.get(corridor)?.currentExposure ?? 0;
  }

  /** Get the exposure limit for a corridor. */
  getLimit(fromCurrency: string, toCurrency: string): FxExposureLimit | null {
    const corridor = this.corridorKey(`${fromCurrency}:${toCurrency}`);
    return this.limits.get(corridor) ?? null;
  }

  /** List all open positions (for dashboard). */
  listOpenPositions(): FxPosition[] {
    return Array.from(this.positions.values()).filter((p) => p.status === 'open');
  }

  /** Expire positions older than the timeout (settlement didn't complete). */
  sweepExpired(timeoutMs: number = 300_000): FxPosition[] {
    const now = Date.now();
    const expired: FxPosition[] = [];
    for (const position of this.positions.values()) {
      if (position.status === 'open' && now - position.openedAt > timeoutMs) {
        position.status = 'expired';
        position.closedAt = now;
        const limit = this.limits.get(position.corridor);
        if (limit) {
          limit.currentExposure = Math.max(0, limit.currentExposure - position.sourceAmount);
        }
        expired.push(position);
      }
    }
    return expired;
  }

  private corridorKey(corridor: string): string {
    // Normalize: 'GHS:NGN' and 'NGN:GHS' share the same limit
    const parts = corridor.split(':');
    return parts.length === 2 ? [parts[0], parts[1]].sort().join(':') : corridor;
  }
}

/** Singleton FX exposure service. */
export const fxExposureService = new FxExposureService();

// Default limits per corridor (in source currency units)
export const DEFAULT_FX_LIMITS: Record<string, number> = {
  'GHS:KES': 500_000,
  'GHS:NGN': 500_000,
  'GHS:XOF': 200_000,
  'KES:NGN': 300_000,
  'KES:GHS': 500_000,
  'NGN:GHS': 500_000,
  'NGN:KES': 300_000,
  'XOF:GHS': 200_000,
};

// Initialize default limits
for (const [corridor, limit] of Object.entries(DEFAULT_FX_LIMITS)) {
  fxExposureService.setLimit(corridor, limit);
}
