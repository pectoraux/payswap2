/**
 * Bandwidth Engine — manages LP bandwidth as a first-class runtime asset.
 * (M-RT-30.)
 *
 * Bandwidth is never represented as balances — it's capacity that can be
 * reserved, used, escrowed, and slashed.
 *
 *   BandwidthPosition
 *   ├── capacity    (total capacity)
 *   ├── reserved    (locked for pending settlement)
 *   ├── used        (consumed by completed settlement)
 *   ├── available   (capacity - reserved - used)
 *   ├── escrow      (locked as collateral for settlement safety)
 *   └── bond        (additional collateral that can be slashed)
 *
 * Automatic Escrow Rebalancing:
 *   If escrow becomes insufficient, runtime automatically moves part of
 *   available bandwidth into escrow. Priority: Bandwidth → Escrow → Settlement.
 */

import type { BandwidthPosition } from './types';
import type { StoredEvent } from '../events';

export class BandwidthEngine {
  readonly handles = ['bandwidth.'] as const;
  private readonly positions = new Map<string, BandwidthPosition>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;

  private posKey(owner: string, country: string, assetType: string): string {
    return `${owner}:${country}:${assetType}`;
  }

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) this.lastPosition = events[events.length - 1].globalPosition;
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    this.positions.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) { this.applyOne(ev); this.eventsAppliedCount++; }
    if (allEvents.length > 0) this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
  }

  checkpoint(): number { return this.lastPosition; }

  /** Get a bandwidth position. */
  get(owner: string, country: string, assetType: 'twin_token' | 'stablecoin'): BandwidthPosition | null {
    return this.positions.get(this.posKey(owner, country, assetType)) ?? null;
  }

  /** List all bandwidth positions. */
  list(): BandwidthPosition[] {
    return [...this.positions.values()];
  }

  /** Get total available bandwidth for a country + asset type. */
  getAvailableBandwidth(country: string, assetType: 'twin_token' | 'stablecoin'): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      if (pos.country === country && pos.assetType === assetType && pos.status === 'active') {
        total += pos.available;
      }
    }
    return total;
  }

  /** Count positions. */
  count(): number { return this.positions.size; }

  /** Events applied. */
  eventsApplied(): number { return this.eventsAppliedCount; }

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    switch (event.type) {
      case 'bandwidth.locked':
      case 'bandwidth.released':
      case 'bandwidth.escrowed':
      case 'bandwidth.slashed': {
        const p = event.payload as { owner: string; country: string; assetType: 'twin_token' | 'stablecoin'; amount: number };
        const key = this.posKey(p.owner, p.country, p.assetType);
        let pos = this.positions.get(key);
        if (!pos) {
          pos = { owner: p.owner, country: p.country, assetType: p.assetType, capacity: 0, reserved: 0, used: 0, available: 0, escrow: 0, bond: 0, status: 'active', participationMode: 'automatic' };
          this.positions.set(key, pos);
        }

        if (event.type === 'bandwidth.locked') {
          pos.reserved += p.amount;
          pos.available = pos.capacity - pos.reserved - pos.used;
        } else if (event.type === 'bandwidth.released') {
          pos.reserved -= p.amount;
          pos.available = pos.capacity - pos.reserved - pos.used;
        } else if (event.type === 'bandwidth.escrowed') {
          pos.escrow += p.amount;
          pos.available = Math.max(0, pos.available - p.amount);
        } else if (event.type === 'bandwidth.slashed') {
          // Slash order: escrow → bond → bandwidth (capacity).
          let remaining = p.amount;
          const fromEscrow = Math.min(remaining, pos.escrow);
          pos.escrow -= fromEscrow; remaining -= fromEscrow;
          const fromBond = Math.min(remaining, pos.bond);
          pos.bond -= fromBond; remaining -= fromBond;
          if (remaining > 0) {
            pos.capacity -= remaining;
          }
          pos.available = pos.capacity - pos.reserved - pos.used;
        }
        break;
      }
      case 'bandwidth.registered': {
        const p = event.payload as { owner: string; country: string; assetType: 'twin_token' | 'stablecoin'; capacity: number; bond: number; participationMode: 'automatic' | 'manual' };
        const key = this.posKey(p.owner, p.country, p.assetType);
        if (!this.positions.has(key)) {
          this.positions.set(key, {
            owner: p.owner, country: p.country, assetType: p.assetType,
            capacity: p.capacity, reserved: 0, used: 0, available: p.capacity,
            escrow: 0, bond: p.bond, status: 'active', participationMode: p.participationMode,
          });
        }
        break;
      }
      default: break;
    }
  }
}

/**
 * Settlement Contract Engine — manages the settlement contract lifecycle.
 * (M-RT-30.)
 *
 *   Created → Funded → Claimed → Accepted → AwaitingRecipient
 *           → Confirmed → Released → Closed
 *                        ↓
 *                     Expired → Disputed
 */
export class SettlementContractEngine {
  readonly handles = ['settlement.contract.'] as const;
  private readonly contracts = new Map<string, import('./types').SettlementContract>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) this.lastPosition = events[events.length - 1].globalPosition;
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    this.contracts.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) { this.applyOne(ev); this.eventsAppliedCount++; }
    if (allEvents.length > 0) this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
  }

  checkpoint(): number { return this.lastPosition; }

  get(contractId: string): import('./types').SettlementContract | null {
    return this.contracts.get(contractId) ?? null;
  }

  list(): import('./types').SettlementContract[] {
    return [...this.contracts.values()];
  }

  listByStatus(status: import('./types').SettlementContractStatus): import('./types').SettlementContract[] {
    return this.list().filter((c) => c.status === status);
  }

  count(): number { return this.contracts.size; }

  eventsApplied(): number { return this.eventsAppliedCount; }

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    switch (event.type) {
      case 'settlement.contract.created': {
        const p = event.payload as { contractId: string; fromCountry: string; toCountry: string; amount: number; currency: string; stablecoinAmount: number; stablecoinCurrency: string; expiresAt: number };
        if (this.contracts.has(p.contractId)) return;
        this.contracts.set(p.contractId, {
          contractId: p.contractId, fromCountry: p.fromCountry, toCountry: p.toCountry,
          amount: p.amount, currency: p.currency, lpId: null,
          stablecoinAmount: p.stablecoinAmount, stablecoinCurrency: p.stablecoinCurrency,
          status: 'created', escrowLocked: false,
          createdAt: ts, fundedAt: null, claimedAt: null, confirmedAt: null, releasedAt: null, closedAt: null,
          expiresAt: p.expiresAt, disputeId: null,
        });
        break;
      }
      case 'settlement.contract.funded': {
        const p = event.payload as { contractId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'funded'; c.fundedAt = ts; c.escrowLocked = true;
        break;
      }
      case 'settlement.contract.claimed': {
        const p = event.payload as { contractId: string; lpId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'claimed'; c.claimedAt = ts; c.lpId = p.lpId;
        break;
      }
      case 'settlement.contract.confirmed': {
        const p = event.payload as { contractId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'confirmed'; c.confirmedAt = ts;
        break;
      }
      case 'settlement.contract.released': {
        const p = event.payload as { contractId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'released'; c.releasedAt = ts; c.escrowLocked = false;
        break;
      }
      case 'settlement.contract.closed': {
        const p = event.payload as { contractId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'closed'; c.closedAt = ts;
        break;
      }
      case 'settlement.contract.expired': {
        const p = event.payload as { contractId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'expired';
        break;
      }
      case 'settlement.disputed': {
        const p = event.payload as { contractId: string; disputeId: string };
        const c = this.contracts.get(p.contractId); if (!c) return;
        c.status = 'disputed'; c.disputeId = p.disputeId;
        break;
      }
      default: break;
    }
  }
}

/**
 * Dispute Engine — manages settlement disputes.
 * (M-RT-30.)
 *
 *   Evidence → AI Evaluation → Community Review → PaySwap Arbitration → Resolution
 */
export class DisputeEngine {
  readonly handles = ['settlement.disputed', 'dispute.'] as const;
  private readonly disputes = new Map<string, import('./types').SettlementDispute>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) { this.applyOne(ev); this.eventsAppliedCount++; }
    if (events.length > 0) this.lastPosition = events[events.length - 1].globalPosition;
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    this.disputes.clear(); this.lastPosition = -1; this.eventsAppliedCount = 0;
    for (const ev of allEvents) { this.applyOne(ev); this.eventsAppliedCount++; }
    if (allEvents.length > 0) this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
  }

  checkpoint(): number { return this.lastPosition; }
  get(disputeId: string): import('./types').SettlementDispute | null { return this.disputes.get(disputeId) ?? null; }
  list(): import('./types').SettlementDispute[] { return [...this.disputes.values()]; }
  count(): number { return this.disputes.size; }
  eventsApplied(): number { return this.eventsAppliedCount; }

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    switch (event.type) {
      case 'settlement.disputed': {
        const p = event.payload as { disputeId: string; contractId: string; reason: string };
        if (this.disputes.has(p.disputeId)) return;
        this.disputes.set(p.disputeId, {
          disputeId: p.disputeId, contractId: p.contractId, reason: p.reason,
          evidence: [], status: 'open', resolution: null, slashingApplied: false,
          createdAt: ts, resolvedAt: null,
        });
        break;
      }
      case 'dispute.evidence_submitted': {
        const p = event.payload as { disputeId: string; type: string; submittedBy: string; data: string };
        const d = this.disputes.get(p.disputeId); if (!d) return;
        d.evidence.push({ type: p.type as never, submittedBy: p.submittedBy, data: p.data, submittedAt: ts });
        break;
      }
      case 'dispute.status_changed': {
        const p = event.payload as { disputeId: string; status: string };
        const d = this.disputes.get(p.disputeId); if (!d) return;
        d.status = p.status as never;
        break;
      }
      case 'dispute.resolved': {
        const p = event.payload as { disputeId: string; resolution: string; slashingApplied: boolean };
        const d = this.disputes.get(p.disputeId); if (!d) return;
        d.resolution = p.resolution as never; d.slashingApplied = p.slashingApplied;
        d.status = 'resolved'; d.resolvedAt = ts;
        break;
      }
      default: break;
    }
  }
}
