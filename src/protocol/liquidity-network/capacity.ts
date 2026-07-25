/**
 * Capacity Management — reservation, release, consumption, replenishment.
 *
 * Invariants:
 *  1. availableCapacity never goes negative (reservations check before
 *     decrementing; if insufficient, reservation fails).
 *  2. Reservations auto-expire (lazy on access + optional background sweep).
 *  3. reserve → consume converts reserved into actually-provided liquidity
 *     (reserved -= amount; availableCapacity stays reduced — the LP provided
 *     the liquidity, so it's no longer available).
 *  4. reserve → release reverses the reservation (available += amount,
 *     reserved -= amount) — used when a plan is cancelled before settlement.
 *  5. replenish adds NEW capacity (LP adds more after settling inbound) —
 *     it increases both `capacity` and `availableCapacity`.
 *
 * All numbers are in `fromCurrency` units of the corridor.
 */
import { eventEngine } from '@/kernel/event';
import { uid } from '@/kernel/support';
import {
  corridorKey,
  DEFAULT_RESERVATION_TTL_MS,
  type Corridor,
  type LPId,
} from './types';
import { liquidityRegistry } from './registry';

export interface Reservation {
  id: string;
  lpId: LPId;
  corridor: Corridor;
  amount: number;
  expiresAt: number;
  state: 'reserved' | 'consumed' | 'released' | 'expired';
  createdAt: number;
}

export interface ReservationResult {
  success: boolean;
  reservationId?: string;
  expiresAt?: number;
  reason?: string;
}

/**
 * CapacityReservationStore — holds all active (and historical) reservations.
 * Lookup by id and by LP (so release-on-LP-shutdown is fast).
 */
export class CapacityReservationStore {
  private reservations: Map<string, Reservation> = new Map();

  /** Add a reservation. */
  add(r: Reservation): void {
    this.reservations.set(r.id, r);
  }

  /** Get a reservation by id. */
  get(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }

  /** All reservations (any state). */
  all(): Reservation[] {
    return [...this.reservations.values()];
  }

  /** Active (non-terminal) reservations. */
  active(): Reservation[] {
    return this.all().filter((r) => r.state === 'reserved');
  }

  /** All reservations for a given LP. */
  byLp(lpId: LPId): Reservation[] {
    return this.all().filter((r) => r.lpId === lpId);
  }

  /** Remove a reservation. */
  remove(id: string): boolean {
    return this.reservations.delete(id);
  }

  /** Clear all reservations (test helper). */
  reset(): void {
    this.reservations.clear();
  }

  /**
   * Sweep expired reservations — move them to `expired` state and refund
   * available capacity. Returns the count swept.
   *
   * This is the lazy expiration path; called by `reserveCapacity` and
   * `getAvailableCapacity` to keep capacity numbers fresh. An optional
   * background sweep can also be scheduled via `startPeriodicSweep`.
   */
  sweepExpired(now: number = Date.now()): number {
    let swept = 0;
    for (const r of this.reservations.values()) {
      if (r.state === 'reserved' && r.expiresAt <= now) {
        // Refund the LP's capacity before marking expired.
        const lp = liquidityRegistry.get(r.lpId);
        if (lp) {
          const key = corridorKey(r.corridor);
          lp.availableCapacity[key] = (lp.availableCapacity[key] ?? 0) + r.amount;
          lp.reservedCapacity[key] = Math.max(0, (lp.reservedCapacity[key] ?? 0) - r.amount);
        }
        r.state = 'expired';
        swept += 1;
        eventEngine.emit('liquidity.capacity_reservation_expired', {
          reservationId: r.id,
          lpId: r.lpId,
          corridor: r.corridor,
          amount: r.amount,
        }, 0);
      }
    }
    return swept;
  }

  /**
   * Start a periodic background sweep. Returns a stop function.
   * (In production this is a setInterval; in tests, call sweepExpired manually.)
   */
  startPeriodicSweep(intervalMs: number): () => void {
    const handle = setInterval(() => this.sweepExpired(), intervalMs);
    return () => clearInterval(handle);
  }
}

/** Singleton reservation store. */
export const capacityReservations = new CapacityReservationStore();

/**
 * Get available capacity for an LP on a corridor, after sweeping expired
 * reservations. Returns 0 if the LP or corridor is unknown.
 *
 * Available capacity = capacity − reserved − consumed.
 * (Consumed capacity is already subtracted from `capacity` and
 *  `availableCapacity` at consume time, so the formula collapses to
 *  `availableCapacity[key]`.)
 */
export function getAvailableCapacity(lpId: LPId, corridor: Corridor): number {
  capacityReservations.sweepExpired();
  const lp = liquidityRegistry.get(lpId);
  if (!lp) return 0;
  const key = corridorKey(corridor);
  return Math.max(0, lp.availableCapacity[key] ?? 0);
}

/**
 * Reserve capacity on an LP for a corridor.
 *
 *  - Checks available capacity (after sweeping expired reservations).
 *  - If insufficient, returns `{ success: false, reason: 'insufficient_capacity' }`.
 *  - Otherwise decrements `availableCapacity` and increments `reservedCapacity`.
 *  - Creates a reservation record with the supplied (or generated) id and TTL.
 *
 * If `reservationId` is not supplied, a new uid is generated. This allows
 * routing plans to use deterministic reservation ids when executing a plan
 * (one reservation per route entry, derived from the plan id + LP index).
 */
export function reserveCapacity(
  lpId: LPId,
  corridor: Corridor,
  amount: number,
  reservationId?: string,
  ttlMs: number = DEFAULT_RESERVATION_TTL_MS,
  now: number = Date.now(),
): ReservationResult {
  if (amount <= 0) {
    return { success: false, reason: 'amount_must_be_positive' };
  }
  capacityReservations.sweepExpired(now);
  const lp = liquidityRegistry.get(lpId);
  if (!lp) return { success: false, reason: 'lp_not_found' };
  if (lp.state !== 'active') return { success: false, reason: 'lp_not_active' };

  const key = corridorKey(corridor);
  const available = lp.availableCapacity[key] ?? 0;
  if (available < amount) {
    return { success: false, reason: 'insufficient_capacity' };
  }

  lp.availableCapacity[key] = available - amount;
  lp.reservedCapacity[key] = (lp.reservedCapacity[key] ?? 0) + amount;

  const id = reservationId ?? uid('res');
  const expiresAt = now + ttlMs;
  const reservation: Reservation = {
    id,
    lpId,
    corridor,
    amount,
    expiresAt,
    state: 'reserved',
    createdAt: now,
  };
  capacityReservations.add(reservation);

  eventEngine.emit('liquidity.capacity_reserved', {
    reservationId: id,
    lpId,
    corridor,
    amount,
    expiresAt,
  }, 0);

  return { success: true, reservationId: id, expiresAt };
}

/**
 * Release a reservation — reverses the reservation. Used when a plan is
 * cancelled before settlement. Available += amount, reserved -= amount.
 *
 * Idempotent: releasing an already-released/consumed/expired reservation is a
 * no-op (returns true).
 */
export function releaseCapacity(reservationId: string): boolean {
  const r = capacityReservations.get(reservationId);
  if (!r) return false;
  if (r.state !== 'reserved') return true;

  const lp = liquidityRegistry.get(r.lpId);
  if (lp) {
    const key = corridorKey(r.corridor);
    lp.availableCapacity[key] = (lp.availableCapacity[key] ?? 0) + r.amount;
    lp.reservedCapacity[key] = Math.max(0, (lp.reservedCapacity[key] ?? 0) - r.amount);
  }
  r.state = 'released';

  eventEngine.emit('liquidity.capacity_released', {
    reservationId: r.id,
    lpId: r.lpId,
    corridor: r.corridor,
    amount: r.amount,
  }, 0);
  return true;
}

/**
 * Consume a reservation — converts the reservation to actual usage. The LP
 * provided the liquidity, so:
 *   - reserved -= amount (reservation is no longer pending)
 *   - capacity -= amount (the LP's total staked capacity is now lower — they
 *     spent liquidity on this settlement)
 *   - availableCapacity stays reduced (it was already decremented at reserve
 *     time; consume doesn't touch it again)
 *
 * Idempotent.
 */
export function consumeCapacity(reservationId: string): boolean {
  const r = capacityReservations.get(reservationId);
  if (!r) return false;
  if (r.state !== 'reserved') return true;

  const lp = liquidityRegistry.get(r.lpId);
  if (lp) {
    const key = corridorKey(r.corridor);
    lp.reservedCapacity[key] = Math.max(0, (lp.reservedCapacity[key] ?? 0) - r.amount);
    lp.capacity[key] = Math.max(0, (lp.capacity[key] ?? 0) - r.amount);
    // availableCapacity unchanged — it was already decremented at reserve.
  }
  r.state = 'consumed';

  eventEngine.emit('liquidity.capacity_consumed', {
    reservationId: r.id,
    lpId: r.lpId,
    corridor: r.corridor,
    amount: r.amount,
  }, 0);
  return true;
}

/**
 * Replenish capacity — LP adds more liquidity (e.g. after settling an inbound
 * transfer). Increases both `capacity` and `availableCapacity` for the
 * corridor. Returns the new available capacity.
 */
export function replenishCapacity(lpId: LPId, corridor: Corridor, amount: number): number {
  if (amount <= 0) return getAvailableCapacity(lpId, corridor);
  capacityReservations.sweepExpired();
  const lp = liquidityRegistry.get(lpId);
  if (!lp) return 0;
  const key = corridorKey(corridor);
  lp.capacity[key] = (lp.capacity[key] ?? 0) + amount;
  lp.availableCapacity[key] = (lp.availableCapacity[key] ?? 0) + amount;

  eventEngine.emit('liquidity.capacity_replenished', {
    lpId, corridor, amount, newCapacity: lp.capacity[key],
  }, 0);

  return lp.availableCapacity[key];
}

/**
 * Release ALL reservations for an LP (e.g. when the LP is paused/drained).
 * Useful when an LP transitions out of active state — all its in-flight
 * reservations are released so the routing layer can find alternatives.
 */
export function releaseAllForLp(lpId: LPId): number {
  let released = 0;
  for (const r of capacityReservations.byLp(lpId)) {
    if (r.state === 'reserved') {
      if (releaseCapacity(r.id)) released += 1;
    }
  }
  return released;
}
