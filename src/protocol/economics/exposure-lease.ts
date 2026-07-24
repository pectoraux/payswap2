/**
 * PaySwap Protocol — Exposure Lease.
 *
 * Exposure is not allocated — it's leased. Like cloud infrastructure: you
 * reserve capacity for a period, renew it, release it, or let it expire.
 *
 *   Exposure Lease {
 *     owner, capacity, reserved, expires, renewed, released
 *   }
 *
 * The solver doesn't allocate exposure — it leases it.
 */
import { uid, round } from '@/kernel/support';

export type LeaseState =
  | 'active'      // currently held
  | 'released'    // voluntarily released
  | 'expired'     // time ran out
  | 'consumed'    // used for settlement
  | 'transferred' // moved to another LP
  | 'revoked';    // revoked for cause (fraud, etc.)

export interface ExposureLease {
  id: string;
  lpId: string;             // LP owning the capacity
  transactionId: string;    // transaction this lease is for
  capacity: number;         // how much exposure is leased
  currency: string;
  state: LeaseState;
  leasedAt: number;
  expiresAt: number;        // lease expires if not renewed
  renewedAt: number | null;
  releasedAt: number | null;
  renewalCount: number;
}

export interface LPCapacity {
  lpId: string;
  totalCapacity: number;    // total exposure this LP can lease
  currency: string;
  leases: ExposureLease[];
}

export class ExposureLeaseManager {
  private capacities: Map<string, LPCapacity> = new Map();
  private leases: Map<string, ExposureLease> = new Map();

  /** Register an LP's total capacity. */
  registerCapacity(lpId: string, totalCapacity: number, currency: string): LPCapacity {
    const cap: LPCapacity = { lpId, totalCapacity, currency, leases: [] };
    this.capacities.set(lpId, cap);
    return cap;
  }

  /** Lease exposure for a transaction. Returns the lease if successful. */
  lease(lpId: string, transactionId: string, capacity: number, currency: string, ttlMs: number = 300000): ExposureLease | null {
    const cap = this.capacities.get(lpId);
    if (!cap || cap.currency !== currency) return null;
    if (this.available(lpId) < capacity) return null;

    const now = Date.now();
    const lease: ExposureLease = {
      id: uid('lease'),
      lpId,
      transactionId,
      capacity,
      currency,
      state: 'active',
      leasedAt: now,
      expiresAt: now + ttlMs,
      renewedAt: null,
      releasedAt: null,
      renewalCount: 0,
    };
    cap.leases.push(lease);
    this.leases.set(lease.id, lease);
    return lease;
  }

  /** Renew a lease (extend its expiry). */
  renew(leaseId: string, extensionMs: number = 120000): ExposureLease | null {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.state !== 'active') return null;
    lease.expiresAt = Date.now() + extensionMs;
    lease.renewedAt = Date.now();
    lease.renewalCount++;
    return lease;
  }

  /** Release a lease (voluntarily, before settlement). */
  release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.state !== 'active') return;
    lease.state = 'released';
    lease.releasedAt = Date.now();
  }

  /** Consume a lease (settlement completed). */
  consume(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.state !== 'active') return;
    lease.state = 'consumed';
    lease.releasedAt = Date.now();
  }

  /** Transfer a lease to a replacement LP. */
  transfer(leaseId: string, toLpId: string, newTransactionId: string): ExposureLease | null {
    const oldLease = this.leases.get(leaseId);
    if (!oldLease || oldLease.state !== 'active') return null;
    const toCap = this.capacities.get(toLpId);
    if (!toCap || toCap.currency !== oldLease.currency) return null;
    if (this.available(toLpId) < oldLease.capacity) return null;

    // Mark old lease as transferred
    oldLease.state = 'transferred';
    oldLease.releasedAt = Date.now();

    // Create new lease for replacement LP
    return this.lease(toLpId, newTransactionId, oldLease.capacity, oldLease.currency);
  }

  /** Revoke a lease (for cause — fraud, etc.). */
  revoke(leaseId: string, reason: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    lease.state = 'revoked';
    lease.releasedAt = Date.now();
  }

  /** Expire all leases that have passed their TTL. */
  expireAll(now: number = Date.now()): number {
    let count = 0;
    for (const lease of this.leases.values()) {
      if (lease.state === 'active' && now >= lease.expiresAt) {
        lease.state = 'expired';
        lease.releasedAt = now;
        count++;
      }
    }
    return count;
  }

  /** Available (unleased) capacity for an LP. */
  available(lpId: string): number {
    const cap = this.capacities.get(lpId);
    if (!cap) return 0;
    const leased = cap.leases
      .filter((l) => l.state === 'active')
      .reduce((sum, l) => sum + l.capacity, 0);
    return round(cap.totalCapacity - leased, 2);
  }

  /** Utilization (0..1). */
  utilization(lpId: string): number {
    const cap = this.capacities.get(lpId);
    if (!cap || cap.totalCapacity === 0) return 0;
    const leased = cap.leases.filter((l) => l.state === 'active').reduce((s, l) => s + l.capacity, 0);
    return round(leased / cap.totalCapacity, 4);
  }

  /** Get all leases. */
  allLeases(): ExposureLease[] {
    return [...this.leases.values()];
  }

  /** Get all capacities. */
  allCapacities(): LPCapacity[] {
    return [...this.capacities.values()];
  }

  reset(): void {
    this.capacities.clear();
    this.leases.clear();
  }
}

export const exposureLeaseManager = new ExposureLeaseManager();
