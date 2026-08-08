/**
 * PaySwap Protocol — Resilience — Partial Settlement Recovery.
 *
 * When a multi-LP settlement only partially completes (some LPs settle, others
 * fail), the recovery engine records the gap and decides on a recovery
 * strategy:
 *
 *   1. `retry_remaining` — alternate LPs are available; re-route the
 *      remaining amount through them.
 *   2. `reverse_all`    — no alternates available; reverse the partially
 *      settled legs so the merchant is made whole again.
 *   3. `manual_review`  — neither retry nor reversal succeeded; flag for
 *      human review.
 *
 * The engine is in-memory + single-process; production deployments would
 * persist partial settlement records to a DB for cross-restart recovery.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/support`.
 */
import { nowTs, round } from '@/kernel/support';

/** Recovery strategy chosen by the engine. */
export type RecoveryStrategy = 'retry_remaining' | 'reverse_all' | 'manual_review';

/** Lifecycle state of a partial settlement record. */
export type PartialSettlementState = 'partial' | 'recovered' | 'failed';

/** A recorded partial settlement — the gap between expected and settled. */
export interface PartialSettlementEntry {
  /** Payment id this partial settlement belongs to. */
  paymentId: string;
  /** ts the partial settlement was recorded. */
  recordedAt: number;
  /** Per-LP expected amounts. */
  expected: Record<string, number>;
  /** Per-LP settled amounts. */
  settled: Record<string, number>;
  /** Sum of expected amounts. */
  expectedAmount: number;
  /** Sum of settled amounts. */
  settledAmount: number;
  /** expectedAmount - settledAmount. */
  remainingAmount: number;
  /** LPs that did NOT settle their expected amount. */
  failedLps: string[];
  /** Current lifecycle state. */
  state: PartialSettlementState;
  /** Recovery strategy chosen (set after `recover()` runs). */
  strategy?: RecoveryStrategy;
  /** ts the recovery completed, if it has. */
  recoveredAt?: number;
}

/** Result of a recovery attempt. */
export interface RecoveryResult {
  paymentId: string;
  state: PartialSettlementState;
  strategy: RecoveryStrategy;
  /** Alternate LPs the router suggested (empty if none). */
  alternateLps?: string[];
  /** Whether the reversal succeeded (only meaningful for `reverse_all`). */
  reversed?: boolean;
  /** ts the recovery completed. */
  recoveredAt: number;
}

/**
 * Router function: given the remaining amount + the LPs to exclude (the
 * failed ones), suggest alternate LPs. Return `null` to indicate no
 * alternates are available.
 */
export type RouterFn = (
  remainingAmount: number,
  excludeLps: string[],
) => string[] | null;

/** Reverse function: attempt to reverse the partially settled legs. */
export type ReverseFn = () => Promise<boolean>;

/**
 * In-memory partial settlement recovery engine.
 */
export class PartialSettlementRecovery {
  private readonly entries = new Map<string, PartialSettlementEntry>();

  /**
   * Record a partial settlement. Computes the gap between expected and
   * settled, identifies the failed LPs, and stores the entry for later
   * recovery.
   */
  record(
    paymentId: string,
    expected: Record<string, number>,
    settled: Record<string, number>,
  ): PartialSettlementEntry {
    const expectedAmount = round(sumValues(expected), 6);
    const settledAmount = round(sumValues(settled), 6);
    const remainingAmount = round(expectedAmount - settledAmount, 6);
    const failedLps = Object.keys(expected).filter(
      (lp) => (expected[lp] ?? 0) - (settled[lp] ?? 0) > 1e-9,
    );
    const entry: PartialSettlementEntry = {
      paymentId,
      recordedAt: nowTs(),
      expected,
      settled,
      expectedAmount,
      settledAmount,
      remainingAmount,
      failedLps,
      state: 'partial',
    };
    this.entries.set(paymentId, entry);
    return entry;
  }

  /**
   * Attempt to recover a partial settlement.
   *
   * Strategy:
   *   1. If `routerFn` returns alternate LPs → `retry_remaining` (state=recovered).
   *   2. Else if `reverseFn` returns true → `reverse_all` (state=recovered).
   *   3. Else → `manual_review` (state=failed).
   */
  async recover(
    paymentId: string,
    routerFn: RouterFn,
    reverseFn: ReverseFn,
  ): Promise<RecoveryResult> {
    const entry = this.entries.get(paymentId);
    if (!entry) {
      throw new Error(`partial settlement not found for payment ${paymentId}`);
    }
    const recoveredAt = nowTs();
    const alternates = routerFn(entry.remainingAmount, entry.failedLps);
    if (alternates && alternates.length > 0) {
      entry.state = 'recovered';
      entry.strategy = 'retry_remaining';
      entry.recoveredAt = recoveredAt;
      return {
        paymentId,
        state: 'recovered',
        strategy: 'retry_remaining',
        alternateLps: alternates,
        recoveredAt,
      };
    }
    const reversed = await reverseFn();
    if (reversed) {
      entry.state = 'recovered';
      entry.strategy = 'reverse_all';
      entry.recoveredAt = recoveredAt;
      return {
        paymentId,
        state: 'recovered',
        strategy: 'reverse_all',
        reversed: true,
        recoveredAt,
      };
    }
    entry.state = 'failed';
    entry.strategy = 'manual_review';
    entry.recoveredAt = recoveredAt;
    return {
      paymentId,
      state: 'failed',
      strategy: 'manual_review',
      reversed: false,
      recoveredAt,
    };
  }

  /** Look up a partial settlement by payment id. */
  get(paymentId: string): PartialSettlementEntry | undefined {
    const entry = this.entries.get(paymentId);
    return entry ? { ...entry } : undefined;
  }

  /** All partial settlements (copies). */
  all(): PartialSettlementEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  /** Number of partial settlements in a given state. */
  countByState(state: PartialSettlementState): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.state === state) n += 1;
    }
    return n;
  }

  /** Number of partial settlements awaiting recovery (state='partial'). */
  pendingCount(): number {
    return this.countByState('partial');
  }

  /** Drop a single entry. */
  forget(paymentId: string): boolean {
    return this.entries.delete(paymentId);
  }

  /** Clear every entry. Test helper. */
  reset(): void {
    this.entries.clear();
  }
}

/** Sum the numeric values of a record. */
function sumValues(r: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(r)) s += r[k] ?? 0;
  return s;
}

// Global singleton — survives Next.js dev module re-instantiation.
const _globalForPartialRecovery =
  globalThis as unknown as { __PAYSWAP_PARTIAL_RECOVERY?: PartialSettlementRecovery };
export const partialSettlementRecovery: PartialSettlementRecovery =
  _globalForPartialRecovery.__PAYSWAP_PARTIAL_RECOVERY ?? new PartialSettlementRecovery();
if (!_globalForPartialRecovery.__PAYSWAP_PARTIAL_RECOVERY) {
  _globalForPartialRecovery.__PAYSWAP_PARTIAL_RECOVERY = partialSettlementRecovery;
}
