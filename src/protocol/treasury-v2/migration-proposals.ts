/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Migration Proposals.
 *
 * D1 + D2: Surface the stablecoin → twin token shift per corridor, and
 * PROPOSE migrations (never execute). A proposal is generated when a
 * corridor's FIAT reserve crosses a threshold — the proposal recommends
 * converting some stablecoin capacity into twin-token capacity for that
 * corridor.
 *
 * Why proposals, not executions:
 *  - Migrations move real money. A human must approve.
 *  - The system can be wrong about timing (corridor may be seasonally hot).
 *  - Executing without approval would violate the operator-in-the-loop rule.
 *
 * What this module produces:
 *  - `compositionReport()` — D1: per-corridor % stablecoin vs % twin of
 *    crypto-tier capacity, with trend.
 *  - `proposeMigrations()` — D2: proposals to convert stablecoin capacity
 *    to twin-token capacity when FIAT reserves cross thresholds.
 *
 * The kernel is FROZEN — this module imports only `nowTs`, `uid`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

// ── Types ─────────────────────────────────────────────────────────────────

/** A corridor's current crypto-tier capacity composition. */
export interface CorridorComposition {
  /** Corridor key, e.g. "GHS:NGN" or "GHS:KES". */
  corridor: string;
  /** Source currency. */
  fromCurrency: string;
  /** Destination currency. */
  toCurrency: string;
  /** Twin-token capacity (PaySwap + LP) denominated in destination currency. */
  twinCapacity: number;
  /** Stablecoin capacity (PaySwap + LP) denominated in destination currency. */
  stablecoinCapacity: number;
  /** Total crypto-tier capacity = twinCapacity + stablecoinCapacity. */
  totalCapacity: number;
  /** twinCapacity / totalCapacity (0..1). 1.0 = fully twin. */
  twinPct: number;
  /** stablecoinCapacity / totalCapacity (0..1). */
  stablecoinPct: number;
  /** Whether the destination has a FIAT reserve (twin tokens can exist). */
  destinationHasFiatReserve: boolean;
  /** Destination FIAT reserve size (0 if no reserve). */
  destinationFiatReserve: number;
  /** Trend in twinPct over the last N samples (positive = shifting to twin). */
  twinPctTrend: number;
  /** Last computed timestamp. */
  ts: number;
}

/** Inputs for `compositionReport()`. */
export interface CompositionInput {
  corridor: string;
  fromCurrency: string;
  toCurrency: string;
  /** Twin-token capacity (PaySwap treasury + LP bandwidth) in dest ccy. */
  twinCapacity: number;
  /** Stablecoin capacity (PaySwap treasury + LP bandwidth) in dest ccy. */
  stablecoinCapacity: number;
  /** Destination FIAT reserve size. */
  destinationFiatReserve: number;
}

/** A migration proposal — proposes, never executes. */
export interface MigrationProposal {
  /** Proposal ID. */
  id: string;
  /** Corridor this proposal applies to (e.g. "GHS:NGN"). */
  corridor: string;
  /** Source currency. */
  fromCurrency: string;
  /** Destination currency. */
  toCurrency: string;
  /** Type of migration proposed. */
  type: 'OPEN_FIAT_RESERVE' | 'INCREASE_TWIN_CAPACITY' | 'CONVERT_STABLECOIN_TO_TWIN';
  /** Proposed amount (in destination currency). */
  amount: number;
  /** Current composition snapshot. */
  currentComposition: CorridorComposition;
  /** Expected composition after migration. */
  projectedComposition: CorridorComposition;
  /** Human-readable rationale. */
  rationale: string;
  /** Trigger that fired (e.g. "fiat_reserve_crossed_threshold:50000"). */
  trigger: string;
  /** Severity: 'info' | 'advisory' | 'urgent'. */
  severity: 'info' | 'advisory' | 'urgent';
  /** Status: always 'proposed' when generated. */
  status: 'proposed';
  /** Created timestamp. */
  createdAt: number;
  /** Approver-required: a human must approve before any execution. */
  requiresApproval: true;
}

// ── Engine ────────────────────────────────────────────────────────────────

/**
 * Migration proposal engine. Owns per-corridor composition history (for
 * trend computation) and produces D1 reports + D2 proposals.
 */
export class MigrationProposalEngine {
  /** Per-corridor composition history (newest first). */
  private history = new Map<string, CorridorComposition[]>();
  /** Maximum samples per corridor (bounds memory). */
  private maxHistory = 100;
  /** Generated proposals (newest first). */
  private proposals: MigrationProposal[] = [];
  /** Thresholds for proposal triggers. */
  private thresholds = {
    /** When destination FIAT reserve crosses this, propose opening twin capacity. */
    openFiatReserveThreshold: 50_000,
    /** When twinPct is below this AND dest has FIAT reserve, propose conversion. */
    twinPctLowWatermark: 0.30,
    /** When stablecoin capacity dominates (above this), propose conversion. */
    stablecoinHighWatermark: 0.70,
  };

  /** Configure thresholds. */
  configure(opts: Partial<typeof MigrationProposalEngine.prototype.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...opts };
  }

  /**
   * D1: Compute + record a corridor's composition. Returns the snapshot
   * and updates the rolling history (for trend computation).
   */
  recordComposition(input: CompositionInput): CorridorComposition {
    const totalCapacity = input.twinCapacity + input.stablecoinCapacity;
    const twinPct = totalCapacity > 0 ? input.twinCapacity / totalCapacity : 0;
    const stablecoinPct = totalCapacity > 0 ? input.stablecoinCapacity / totalCapacity : 0;
    const destinationHasFiatReserve = input.destinationFiatReserve > 0;

    const prev = this.history.get(input.corridor)?.[0];
    const twinPctTrend = prev ? twinPct - prev.twinPct : 0;

    const composition: CorridorComposition = {
      corridor: input.corridor,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      twinCapacity: round(input.twinCapacity, 2),
      stablecoinCapacity: round(input.stablecoinCapacity, 2),
      totalCapacity: round(totalCapacity, 2),
      twinPct: Math.round(twinPct * 10000) / 10000,
      stablecoinPct: Math.round(stablecoinPct * 10000) / 10000,
      destinationHasFiatReserve,
      destinationFiatReserve: round(input.destinationFiatReserve, 2),
      twinPctTrend: Math.round(twinPctTrend * 10000) / 10000,
      ts: nowTs(),
    };

    const hist = this.history.get(input.corridor) ?? [];
    hist.unshift(composition);
    if (hist.length > this.maxHistory) hist.length = this.maxHistory;
    this.history.set(input.corridor, hist);

    eventEngine.emit('treasury.composition_recorded', composition);
    return composition;
  }

  /** D1: Get the latest composition for a corridor (or undefined). */
  latestComposition(corridor: string): CorridorComposition | undefined {
    return this.history.get(corridor)?.[0];
  }

  /** D1: Get all latest compositions. */
  allCompositions(): CorridorComposition[] {
    const out: CorridorComposition[] = [];
    for (const hist of this.history.values()) {
      if (hist[0]) out.push(hist[0]);
    }
    return out;
  }

  /** D1: Get the composition history for a corridor. */
  compositionHistory(corridor: string, limit = 30): CorridorComposition[] {
    const hist = this.history.get(corridor) ?? [];
    return hist.slice(0, Math.min(limit, hist.length));
  }

  /**
   * D2: Generate migration proposals for a single corridor. Does NOT
   * execute — only returns proposals for human review.
   */
  proposeForCorridor(input: CompositionInput): MigrationProposal[] {
    const composition = this.recordComposition(input);
    const proposals: MigrationProposal[] = [];

    // Trigger 1: Destination FIAT reserve just crossed the threshold →
    // propose opening twin-token capacity for this corridor.
    if (
      composition.destinationHasFiatReserve &&
      composition.destinationFiatReserve >= this.thresholds.openFiatReserveThreshold &&
      composition.twinPct < 0.5
    ) {
      const amount = Math.min(
        composition.destinationFiatReserve,
        composition.stablecoinCapacity,
      );
      if (amount > 0) {
        proposals.push(this.buildProposal({
          input,
          composition,
          type: 'OPEN_FIAT_RESERVE',
          amount,
          trigger: `fiat_reserve_crossed_threshold:${this.thresholds.openFiatReserveThreshold}`,
          severity: 'advisory',
          rationale: `Destination FIAT reserve is ${composition.destinationFiatReserve} ${input.toCurrency} (>= ${this.thresholds.openFiatReserveThreshold} threshold) but only ${(composition.twinPct * 100).toFixed(1)}% of crypto-tier capacity is twin-token backed. Convert ${amount} ${input.toCurrency} of stablecoin capacity to twin-token capacity to align with the FIAT reserve.`,
        }));
      }
    }

    // Trigger 2: Stablecoin dominates AND destination has FIAT reserve →
    // propose converting stablecoin to twin.
    if (
      composition.destinationHasFiatReserve &&
      composition.stablecoinPct > this.thresholds.stablecoinHighWatermark &&
      composition.stablecoinCapacity > 0
    ) {
      const amount = composition.stablecoinCapacity * 0.5; // propose 50% conversion
      proposals.push(this.buildProposal({
        input,
        composition,
        type: 'CONVERT_STABLECOIN_TO_TWIN',
        amount,
        trigger: `stablecoin_pct_above:${this.thresholds.stablecoinHighWatermark}`,
        severity: 'info',
        rationale: `Stablecoin capacity is ${(composition.stablecoinPct * 100).toFixed(1)}% of total (> ${this.thresholds.stablecoinHighWatermark * 100}% watermark) while destination has a FIAT reserve. Converting ${amount} ${input.toCurrency} of stablecoin capacity to twin-token capacity would reduce stablecoin dependency for this corridor.`,
      }));
    }

    // Trigger 3: Twin capacity below watermark AND FIAT reserve exists →
    // propose increasing twin capacity (via LP onboarding or treasury top-up).
    if (
      composition.destinationHasFiatReserve &&
      composition.twinPct < this.thresholds.twinPctLowWatermark &&
      composition.destinationFiatReserve > composition.twinCapacity
    ) {
      const amount = composition.destinationFiatReserve - composition.twinCapacity;
      proposals.push(this.buildProposal({
        input,
        composition,
        type: 'INCREASE_TWIN_CAPACITY',
        amount,
        trigger: `twin_pct_below:${this.thresholds.twinPctLowWatermark}`,
        severity: 'info',
        rationale: `Twin-token capacity is only ${(composition.twinPct * 100).toFixed(1)}% of crypto-tier capacity (< ${this.thresholds.twinPctLowWatermark * 100}% watermark) while destination FIAT reserve is ${composition.destinationFiatReserve} ${input.toCurrency}. Increase twin-token capacity by ${amount} ${input.toCurrency} (via LP onboarding or treasury mint) to better mirror the FIAT reserve.`,
      }));
    }

    if (proposals.length > 0) {
      eventEngine.emit('treasury.migration_proposed', {
        corridor: input.corridor,
        count: proposals.length,
        proposals,
      });
    }
    return proposals;
  }

  /**
   * D2: Generate migration proposals for ALL corridors in one call.
   * Returns the proposals (also stored internally for retrieval).
   */
  proposeForAll(inputs: CompositionInput[]): MigrationProposal[] {
    const out: MigrationProposal[] = [];
    for (const input of inputs) {
      out.push(...this.proposeForCorridor(input));
    }
    // Prepend to the global proposals list (newest first).
    this.proposals.unshift(...out);
    if (this.proposals.length > 1000) this.proposals.length = 1000;
    return out;
  }

  /** All proposals (newest first). */
  allProposals(): MigrationProposal[] {
    return [...this.proposals];
  }

  /** Pending proposals (status === 'proposed'). */
  pendingProposals(): MigrationProposal[] {
    return this.proposals.filter((p) => p.status === 'proposed');
  }

  /** Mark a proposal as approved/rejected (caller-side state; never executes). */
  reviewProposal(id: string, _decision: 'approved' | 'rejected', _note?: string): MigrationProposal | undefined {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return undefined;
    // D2 says: NEVER execute. We just record the decision. Execution would
    // be a separate treasury operation that goes through the dispatcher.
    eventEngine.emit('treasury.migration_reviewed', {
      proposalId: id,
      decision: _decision,
      note: _note,
      ts: nowTs(),
    });
    return p;
  }

  /** Reset all state. */
  reset(): void {
    this.history.clear();
    this.proposals = [];
  }

  // ── Internal ──

  private buildProposal(opts: {
    input: CompositionInput;
    composition: CorridorComposition;
    type: MigrationProposal['type'];
    amount: number;
    trigger: string;
    severity: MigrationProposal['severity'];
    rationale: string;
  }): MigrationProposal {
    const projectedTwinCapacity = opts.composition.twinCapacity + (
      opts.type === 'CONVERT_STABLECOIN_TO_TWIN' ? opts.amount : 0
    );
    const projectedStablecoinCapacity = opts.composition.stablecoinCapacity - (
      opts.type === 'CONVERT_STABLECOIN_TO_TWIN' ? opts.amount : 0
    );
    const projectedTotal = projectedTwinCapacity + projectedStablecoinCapacity;
    const projectedComposition: CorridorComposition = {
      ...opts.composition,
      twinCapacity: round(projectedTwinCapacity, 2),
      stablecoinCapacity: round(projectedStablecoinCapacity, 2),
      totalCapacity: round(projectedTotal, 2),
      twinPct: projectedTotal > 0 ? Math.round((projectedTwinCapacity / projectedTotal) * 10000) / 10000 : 0,
      stablecoinPct: projectedTotal > 0 ? Math.round((projectedStablecoinCapacity / projectedTotal) * 10000) / 10000 : 0,
      ts: nowTs(),
    };

    return {
      id: uid('mp'),
      corridor: opts.input.corridor,
      fromCurrency: opts.input.fromCurrency,
      toCurrency: opts.input.toCurrency,
      type: opts.type,
      amount: round(opts.amount, 2),
      currentComposition: opts.composition,
      projectedComposition,
      rationale: opts.rationale,
      trigger: opts.trigger,
      severity: opts.severity,
      status: 'proposed',
      createdAt: nowTs(),
      requiresApproval: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_MIGRATION_PROPOSAL_ENGINE: MigrationProposalEngine | undefined;
}

export const migrationProposalEngine: MigrationProposalEngine =
  globalThis.__PAYSWAP_MIGRATION_PROPOSAL_ENGINE ?? new MigrationProposalEngine();

if (!globalThis.__PAYSWAP_MIGRATION_PROPOSAL_ENGINE) {
  globalThis.__PAYSWAP_MIGRATION_PROPOSAL_ENGINE = migrationProposalEngine;
}
