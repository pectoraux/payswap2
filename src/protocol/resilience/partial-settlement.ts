/**
 * PaySwap Protocol — Resilience / Partial Settlement Recovery.
 * -----------------------------------------------------------------------------
 * When a payment is settled across MULTIPLE LPs and some LPs settle while
 * others fail (or time out), the settlement is left in a PARTIAL state:
 *
 *   - Some LPs have already transferred liquidity (their portion is "settled")
 *   - The remaining amount has NOT been settled
 *
 * The PartialSettlementRecovery engine records these, then attempts to
 * recover by re-routing the remaining amount through OTHER LPs (via the
 * liquidity network). If re-routing is not possible (no other LPs available),
 * the settled portion is REVERSED — a full refund — so the payment ends in a
 * consistent state.
 *
 * Recovery states:
 *
 *   partial    → initial state — some LPs settled, some didn't
 *   recovering → re-routing in progress
 *   recovered  → remaining amount successfully re-routed OR fully reversed
 *   failed     → could not recover (manual review required)
 *
 * INVARIANT: A partial settlement is either RECOVERED or FULLY REVERSED —
 * never left half-done. If we cannot re-route, we reverse the settled portion
 * so the payment is consistent (no money "lost" in a partially-settled state).
 */
import { eventEngine } from '@/kernel/event';
import { uid, round } from '@/kernel/support';

/** Recovery state machine. */
export type PartialSettlementState =
  | 'partial'
  | 'recovering'
  | 'recovered'
  | 'failed';

/** Per-LP allocation tracking. */
export interface LPAllocation {
  lpId: string;
  /** Amount this LP was expected to settle. */
  expected: number;
  /** Amount this LP actually settled. */
  settled: number;
  /** Remaining = expected − settled. */
  remaining: number;
}

/** A recorded partial settlement. */
export interface PartialSettlement {
  paymentId: string;
  expectedAmount: number;
  settledAmount: number;
  remainingAmount: number;
  lpAllocations: LPAllocation[];
  state: PartialSettlementState;
  startedAt: number;
  recoveredAt?: number;
  /** Recovery strategy used. */
  strategy?: 'retry_remaining' | 'reverse_all' | 'manual_review';
  /** Free-form notes (e.g. why recovery failed). */
  notes?: string;
}

/**
 * Recovery engine. In-memory store; production would persist each entry to
 * a `partial_settlements` table.
 */
export class PartialSettlementRecovery {
  private entries: Map<string, PartialSettlement> = new Map();

  /**
   * Record a partial settlement.
   *
   * @param paymentId       The payment id.
   * @param allocations     The full LP allocation map (lpId → expected amount).
   * @param settledAmounts  Per-LP settled amounts (lpId → settled amount).
   * @returns The recorded PartialSettlement. If an entry for this paymentId
   *          already exists and is not yet recovered, it's updated; otherwise
   *          a new entry is created.
   */
  record(
    paymentId: string,
    allocations: Record<string, number>,
    settledAmounts: Record<string, number>,
  ): PartialSettlement {
    const lpAllocations: LPAllocation[] = Object.entries(allocations).map(
      ([lpId, expected]) => {
        const settled = settledAmounts[lpId] ?? 0;
        return {
          lpId,
          expected,
          settled,
          remaining: round(expected - settled, 6),
        };
      },
    );
    const expectedAmount = round(
      lpAllocations.reduce((s, a) => s + a.expected, 0),
      6,
    );
    const settledAmount = round(
      lpAllocations.reduce((s, a) => s + a.settled, 0),
      6,
    );
    const remainingAmount = round(expectedAmount - settledAmount, 6);

    // Reuse existing entry if present and still partial/recovering.
    const existing = this.entries.get(paymentId);
    const entry: PartialSettlement =
      existing && (existing.state === 'partial' || existing.state === 'recovering')
        ? existing
        : {
            paymentId,
            expectedAmount,
            settledAmount,
            remainingAmount,
            lpAllocations,
            state: 'partial',
            startedAt: Date.now(),
          };

    // Refresh computed fields.
    entry.expectedAmount = expectedAmount;
    entry.settledAmount = settledAmount;
    entry.remainingAmount = remainingAmount;
    entry.lpAllocations = lpAllocations;

    // Only mark as partial if not already recovered/failed.
    if (entry.state === 'partial' || entry.state === 'recovering') {
      if (remainingAmount <= 0) {
        // Fully settled — no recovery needed.
        entry.state = 'recovered';
        entry.recoveredAt = Date.now();
        entry.strategy = 'retry_remaining';
        entry.notes = 'Fully settled during recording — no recovery needed.';
      } else {
        entry.state = 'partial';
      }
    }

    this.entries.set(paymentId, entry);

    if (entry.state === 'partial') {
      try {
        eventEngine.emit(
          'resilience.partial_settlement_detected',
          {
            paymentId: entry.paymentId,
            expectedAmount: entry.expectedAmount,
            settledAmount: entry.settledAmount,
            remainingAmount: entry.remainingAmount,
            lpCount: entry.lpAllocations.length,
            shortfalls: entry.lpAllocations.filter((a) => a.remaining > 0).map((a) => ({ lpId: a.lpId, remaining: a.remaining })),
            ts: entry.startedAt,
          },
          0,
        );
      } catch {
        // Best-effort.
      }
    }
    return entry;
  }

  /**
   * Attempt to recover a partial settlement.
   *
   * Strategy:
   *   1. retry_remaining — call `routerFn` to find alternate LPs for the
   *      remaining amount. If found, mark recovered.
   *   2. reverse_all — if no alternate LPs available (routerFn returns null
   *      or empty), reverse the settled portion (call `reverseFn`) and mark
   *      recovered (the payment is now fully reversed — consistent state).
   *   3. manual_review — if both routerFn and reverseFn throw / return false,
   *      mark as failed (flag for human intervention).
   *
   * @param paymentId   The payment to recover.
   * @param routerFn    Optional: (remainingAmount, excludeLpIds) → alternate
   *                    LP ids that can settle the remaining amount. Return
   *                    null/empty to indicate "no alternate LPs available".
   * @param reverseFn   Optional: (paymentId) → boolean. Reverses the settled
   *                    portion. Return true on success, false on failure.
   */
  async recover(
    paymentId: string,
    routerFn?: (remainingAmount: number, excludeLpIds: string[]) => string[] | null,
    reverseFn?: (paymentId: string) => Promise<boolean>,
  ): Promise<PartialSettlement> {
    const entry = this.entries.get(paymentId);
    if (!entry) {
      throw new Error(`Partial settlement not found for paymentId=${paymentId}`);
    }
    if (entry.state === 'recovered') return entry;

    entry.state = 'recovering';
    const excludeLpIds = entry.lpAllocations
      .filter((a) => a.settled > 0 || a.remaining > 0)
      .map((a) => a.lpId);

    // Strategy 1: retry_remaining — re-route through other LPs.
    if (routerFn && entry.remainingAmount > 0) {
      try {
        const alternates = routerFn(entry.remainingAmount, excludeLpIds);
        if (alternates && alternates.length > 0) {
          entry.state = 'recovered';
          entry.recoveredAt = Date.now();
          entry.strategy = 'retry_remaining';
          entry.notes = `Re-routed ${entry.remainingAmount} through alternate LPs: ${alternates.join(', ')}`;
          this.entries.set(paymentId, entry);
          this.emitRecovered(entry);
          return entry;
        }
      } catch (err) {
        entry.notes = `routerFn failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Strategy 2: reverse_all — full refund of settled portion.
    if (reverseFn && entry.settledAmount > 0) {
      try {
        const ok = await reverseFn(paymentId);
        if (ok) {
          entry.state = 'recovered';
          entry.recoveredAt = Date.now();
          entry.strategy = 'reverse_all';
          entry.notes = `Reversed settled portion of ${entry.settledAmount} (could not re-route remaining ${entry.remainingAmount}).`;
          this.entries.set(paymentId, entry);
          this.emitRecovered(entry);
          return entry;
        }
        entry.notes = `reverseFn returned false for ${paymentId}`;
      } catch (err) {
        entry.notes = `reverseFn failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Strategy 3: manual_review.
    entry.state = 'failed';
    entry.strategy = 'manual_review';
    if (!entry.notes) {
      entry.notes =
        'No alternate LPs available AND reversal failed — flagged for manual review.';
    }
    this.entries.set(paymentId, entry);
    try {
      eventEngine.emit(
        'resilience.partial_settlement_failed',
        {
          paymentId: entry.paymentId,
          expectedAmount: entry.expectedAmount,
          settledAmount: entry.settledAmount,
          remainingAmount: entry.remainingAmount,
          strategy: entry.strategy,
          notes: entry.notes,
          ts: Date.now(),
        },
        0,
      );
    } catch {
      // Best-effort.
    }
    return entry;
  }

  /** Get a partial settlement by payment id. */
  get(paymentId: string): PartialSettlement | undefined {
    return this.entries.get(paymentId);
  }

  /** List partial settlements (optionally filtered by state). */
  list(filter?: { state?: PartialSettlementState }): PartialSettlement[] {
    const all = [...this.entries.values()];
    if (filter?.state) return all.filter((e) => e.state === filter.state);
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Clear all entries (mainly for tests). */
  reset(): void {
    this.entries.clear();
  }

  private emitRecovered(entry: PartialSettlement): void {
    try {
      eventEngine.emit(
        'resilience.partial_settlement_recovered',
        {
          paymentId: entry.paymentId,
          strategy: entry.strategy,
          expectedAmount: entry.expectedAmount,
          settledAmount: entry.settledAmount,
          remainingAmount: entry.remainingAmount,
          notes: entry.notes,
          ts: entry.recoveredAt,
        },
        0,
      );
    } catch {
      // Best-effort.
    }
  }
}

/** Singleton recovery engine. */
export const partialSettlementRecovery = new PartialSettlementRecovery();
