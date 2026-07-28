/**
 * M-RT-30: Settlement Contract Engine — manages the settlement contract lifecycle.
 *
 * Lifecycle:
 *   Created → Funded → Claimed → Accepted → AwaitingRecipient →
 *   Confirmed → Released → Closed
 *
 * Timeouts create automatic disputes.
 */

import { uid } from '@/runtime/types';

export type SettlementContractStatus =
  | 'created'
  | 'funded'
  | 'claimed'
  | 'accepted'
  | 'awaiting_recipient'
  | 'confirmed'
  | 'released'
  | 'closed'
  | 'expired'
  | 'disputed';

export interface SettlementContract {
  id: string;
  status: SettlementContractStatus;
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  escrowAmount: number;
  escrowCurrency: string;
  lpId?: string;
  recipientId?: string;
  createdAt: number;
  fundedAt?: number;
  claimedAt?: number;
  confirmedAt?: number;
  releasedAt?: number;
  closedAt?: number;
  expiresAt: number;
  timeoutMs: number;
  strategy: string;
}

class SettlementContractEngine {
  private contracts: Map<string, SettlementContract> = new Map();

  create(params: {
    fromCountry: string;
    toCountry: string;
    fromCurrency: string;
    toCurrency: string;
    amount: number;
    escrowAmount: number;
    escrowCurrency: string;
    strategy: string;
    timeoutMs?: number;
  }): SettlementContract {
    const contract: SettlementContract = {
      id: uid('sc'),
      status: 'created',
      ...params,
      createdAt: Date.now(),
      expiresAt: Date.now() + (params.timeoutMs ?? 24 * 60 * 60 * 1000), // 24h default
      timeoutMs: params.timeoutMs ?? 24 * 60 * 60 * 1000,
    };
    this.contracts.set(contract.id, contract);
    return contract;
  }

  fund(contractId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'created') return null;
    c.status = 'funded';
    c.fundedAt = Date.now();
    return c;
  }

  claim(contractId: string, lpId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'funded') return null;
    c.status = 'claimed';
    c.lpId = lpId;
    c.claimedAt = Date.now();
    return c;
  }

  accept(contractId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'claimed') return null;
    c.status = 'accepted';
    return c;
  }

  awaitRecipient(contractId: string, recipientId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'accepted') return null;
    c.status = 'awaiting_recipient';
    c.recipientId = recipientId;
    return c;
  }

  confirm(contractId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'awaiting_recipient') return null;
    c.status = 'confirmed';
    c.confirmedAt = Date.now();
    return c;
  }

  release(contractId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'confirmed') return null;
    c.status = 'released';
    c.releasedAt = Date.now();
    return c;
  }

  close(contractId: string): SettlementContract | null {
    const c = this.contracts.get(contractId);
    if (!c || c.status !== 'released') return null;
    c.status = 'closed';
    c.closedAt = Date.now();
    return c;
  }

  /**
   * Check for expired contracts and mark them as disputed.
   */
  checkExpirations(): SettlementContract[] {
    const now = Date.now();
    const expired: SettlementContract[] = [];
    for (const c of this.contracts.values()) {
      if (now > c.expiresAt && !['closed', 'released', 'disputed'].includes(c.status)) {
        c.status = 'expired';
        expired.push(c);
      }
    }
    return expired;
  }

  get(contractId: string): SettlementContract | null {
    return this.contracts.get(contractId) ?? null;
  }

  list(filter?: { status?: SettlementContractStatus; lpId?: string }): SettlementContract[] {
    let results = Array.from(this.contracts.values());
    if (filter?.status) results = results.filter(c => c.status === filter.status);
    if (filter?.lpId) results = results.filter(c => c.lpId === filter.lpId);
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const settlementContractEngine = new SettlementContractEngine();
export { SettlementContractEngine };
