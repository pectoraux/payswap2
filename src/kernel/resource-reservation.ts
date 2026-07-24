/**
 * PaySwap Runtime — Resource Reservation.
 *
 * Replaces Exposure Lease with a generic resource reservation system. Any
 * scarce resource can be reserved, renewed, consumed, released, transferred,
 * or expired. The kernel doesn't know what the resource is.
 *
 *   ExposureResource, SettlementCapacityResource, EscrowResource, etc.
 *   — all use the same primitive.
 *
 *   reserve() → renew() → consume() | release() | transfer() | expire()
 */
import { uid, round } from './support';

export type ReservationState =
  | 'active'
  | 'consumed'
  | 'released'
  | 'transferred'
  | 'expired'
  | 'revoked';

export interface Reservation {
  id: string;
  resourceType: string;       // e.g. 'exposure', 'settlement_capacity', 'escrow'
  ownerId: string;            // entity owning the resource
  consumerId: string;         // entity reserving it
  amount: number;
  currency?: string;
  state: ReservationState;
  reservedAt: number;
  expiresAt: number;          // TTL — auto-expires
  renewedAt: number | null;
  renewalCount: number;
  meta?: Record<string, unknown>;
}

export interface ResourceCapacity {
  resourceType: string;
  ownerId: string;
  totalCapacity: number;
  currency?: string;
  reservations: Reservation[];
}

export class ResourceReservation {
  private capacities: Map<string, ResourceCapacity> = new Map();
  private reservations: Map<string, Reservation> = new Map();

  private key(resourceType: string, ownerId: string): string {
    return `${resourceType}:${ownerId}`;
  }

  /** Register an entity's total capacity for a resource type. */
  registerCapacity(resourceType: string, ownerId: string, totalCapacity: number, currency?: string): ResourceCapacity {
    const k = this.key(resourceType, ownerId);
    const cap: ResourceCapacity = { resourceType, ownerId, totalCapacity, currency, reservations: [] };
    this.capacities.set(k, cap);
    return cap;
  }

  /** Reserve capacity. Returns the reservation if successful. */
  reserve(resourceType: string, ownerId: string, consumerId: string, amount: number, ttlMs: number = 300000, currency?: string): Reservation | null {
    const k = this.key(resourceType, ownerId);
    const cap = this.capacities.get(k);
    if (!cap) return null;
    if (this.available(resourceType, ownerId) < amount) return null;

    const now = Date.now();
    const r: Reservation = {
      id: uid('res'),
      resourceType, ownerId, consumerId, amount, currency,
      state: 'active',
      reservedAt: now,
      expiresAt: now + ttlMs,
      renewedAt: null,
      renewalCount: 0,
    };
    cap.reservations.push(r);
    this.reservations.set(r.id, r);
    return r;
  }

  /** Renew a reservation (extend TTL). */
  renew(reservationId: string, extensionMs: number = 120000): Reservation | null {
    const r = this.reservations.get(reservationId);
    if (!r || r.state !== 'active') return null;
    r.expiresAt = Date.now() + extensionMs;
    r.renewedAt = Date.now();
    r.renewalCount++;
    return r;
  }

  /** Consume a reservation (resource used). */
  consume(reservationId: string): void {
    const r = this.reservations.get(reservationId);
    if (!r || r.state !== 'active') return;
    r.state = 'consumed';
  }

  /** Release a reservation (voluntarily, before use). */
  release(reservationId: string): void {
    const r = this.reservations.get(reservationId);
    if (!r || r.state !== 'active') return;
    r.state = 'released';
  }

  /** Transfer a reservation to another consumer. */
  transfer(reservationId: string, newConsumerId: string): Reservation | null {
    const old = this.reservations.get(reservationId);
    if (!old || old.state !== 'active') return null;
    old.state = 'transferred';
    // Create new reservation for the new consumer on the same owner's capacity
    return this.reserve(old.resourceType, old.ownerId, newConsumerId, old.amount, old.expiresAt - Date.now(), old.currency);
  }

  /** Revoke a reservation (for cause). */
  revoke(reservationId: string): void {
    const r = this.reservations.get(reservationId);
    if (!r) return;
    r.state = 'revoked';
  }

  /** Expire all active reservations that have passed their TTL. */
  expireAll(now: number = Date.now()): number {
    let count = 0;
    for (const r of this.reservations.values()) {
      if (r.state === 'active' && now >= r.expiresAt) {
        r.state = 'expired';
        count++;
      }
    }
    return count;
  }

  /** Available (unreserved) capacity. */
  available(resourceType: string, ownerId: string): number {
    const k = this.key(resourceType, ownerId);
    const cap = this.capacities.get(k);
    if (!cap) return 0;
    const reserved = cap.reservations
      .filter((r) => r.state === 'active')
      .reduce((sum, r) => sum + r.amount, 0);
    return round(cap.totalCapacity - reserved, 2);
  }

  /** Utilization (0..1). */
  utilization(resourceType: string, ownerId: string): number {
    const k = this.key(resourceType, ownerId);
    const cap = this.capacities.get(k);
    if (!cap || cap.totalCapacity === 0) return 0;
    const reserved = cap.reservations.filter((r) => r.state === 'active').reduce((s, r) => s + r.amount, 0);
    return round(reserved / cap.totalCapacity, 4);
  }

  allReservations(): Reservation[] { return [...this.reservations.values()]; }
  allCapacities(): ResourceCapacity[] { return [...this.capacities.values()]; }

  reset(): void {
    this.capacities.clear();
    this.reservations.clear();
  }
}

export const resourceReservation = new ResourceReservation();
