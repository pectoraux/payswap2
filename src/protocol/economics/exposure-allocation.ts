/**
 * PaySwap Protocol — Exposure as Allocated Resource.
 *
 * Exposure is not computed every request — it's a managed resource, like AWS
 * capacity. LPs own exposure. The solver allocates it.
 *
 *   LP owns: 500,000 exposure
 *   Allocations:
 *     Payment A: 50,000
 *     Payment B: 80,000
 *     Payment C: 120,000
 *   Remaining: 250,000
 *
 * Exposure can be:
 *   - reserved (held for a pending transaction)
 *   - released (freed after settlement or cancellation)
 *   - borrowed (LP borrows from future capacity)
 *   - transferred (replacement LP takes over)
 *   - auctioned (LPs bid exposure in auctions)
 *   - throttled (rate-limited during stress)
 */
import { uid, round } from '@/kernel/support';

export interface ExposureAllocation {
  id: string;
  lpId: string;
  transactionId: string;
  amount: number;
  currency: string;
  state: 'reserved' | 'released' | 'consumed' | 'transferred';
  reservedAt: number;
  releasedAt: number | null;
}

export interface LPExposure {
  lpId: string;
  totalCapacity: number;      // total exposure this LP owns
  currency: string;
  allocations: ExposureAllocation[];
  // Derived (never stored separately):
  //   allocated = sum of active allocations
  //   remaining = totalCapacity - allocated
  //   utilization = allocated / totalCapacity
}

export class ExposureManager {
  private exposures: Map<string, LPExposure> = new Map();

  /** Register an LP's total exposure capacity. */
  register(lpId: string, totalCapacity: number, currency: string): LPExposure {
    const exp: LPExposure = {
      lpId,
      totalCapacity,
      currency,
      allocations: [],
    };
    this.exposures.set(lpId, exp);
    return exp;
  }

  /** Reserve exposure for a transaction. Returns true if successful. */
  reserve(lpId: string, transactionId: string, amount: number, currency: string): ExposureAllocation | null {
    const exp = this.exposures.get(lpId);
    if (!exp) return null;
    if (exp.currency !== currency) return null;
    if (this.remaining(lpId) < amount) return null;

    const allocation: ExposureAllocation = {
      id: uid('alloc'),
      lpId,
      transactionId,
      amount,
      currency,
      state: 'reserved',
      reservedAt: Date.now(),
      releasedAt: null,
    };
    exp.allocations.push(allocation);
    return allocation;
  }

  /** Release reserved exposure (after cancellation). */
  release(lpId: string, allocationId: string): void {
    const exp = this.exposures.get(lpId);
    if (!exp) return;
    const alloc = exp.allocations.find((a) => a.id === allocationId);
    if (alloc && alloc.state === 'reserved') {
      alloc.state = 'released';
      alloc.releasedAt = Date.now();
    }
  }

  /** Consume exposure (after settlement completes). */
  consume(lpId: string, allocationId: string): void {
    const exp = this.exposures.get(lpId);
    if (!exp) return;
    const alloc = exp.allocations.find((a) => a.id === allocationId);
    if (alloc && alloc.state === 'reserved') {
      alloc.state = 'consumed';
      alloc.releasedAt = Date.now();
    }
  }

  /** Transfer exposure to a replacement LP. */
  transfer(fromLpId: string, toLpId: string, allocationId: string, newTransactionId: string): ExposureAllocation | null {
    const fromExp = this.exposures.get(fromLpId);
    const toExp = this.exposures.get(toLpId);
    if (!fromExp || !toExp) return null;

    const alloc = fromExp.allocations.find((a) => a.id === allocationId);
    if (!alloc || alloc.state !== 'reserved') return null;

    // Release from original LP
    alloc.state = 'transferred';
    alloc.releasedAt = Date.now();

    // Reserve on replacement LP
    return this.reserve(toLpId, newTransactionId, alloc.amount, alloc.currency);
  }

  /** Borrow from future capacity (increases total temporarily). */
  borrow(lpId: string, amount: number): boolean {
    const exp = this.exposures.get(lpId);
    if (!exp) return false;
    exp.totalCapacity += amount;
    return true;
  }

  /** Get allocated exposure for an LP. */
  allocated(lpId: string): number {
    const exp = this.exposures.get(lpId);
    if (!exp) return 0;
    return exp.allocations
      .filter((a) => a.state === 'reserved')
      .reduce((sum, a) => sum + a.amount, 0);
  }

  /** Get remaining exposure for an LP. */
  remaining(lpId: string): number {
    const exp = this.exposures.get(lpId);
    if (!exp) return 0;
    return round(exp.totalCapacity - this.allocated(lpId), 2);
  }

  /** Get utilization (0..1). */
  utilization(lpId: string): number {
    const exp = this.exposures.get(lpId);
    if (!exp || exp.totalCapacity === 0) return 0;
    return round(this.allocated(lpId) / exp.totalCapacity, 4);
  }

  /** Get all LP exposures. */
  all(): LPExposure[] {
    return [...this.exposures.values()];
  }

  /** Get a specific LP's exposure. */
  get(lpId: string): LPExposure | undefined {
    return this.exposures.get(lpId);
  }

  reset(): void {
    this.exposures.clear();
  }
}

export const exposureManager = new ExposureManager();
