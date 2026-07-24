/**
 * PaySwap Protocol — Settlement Escrow Module.
 *
 * The guarantee that replaces insurance. Every transaction freezes Twin Tokens
 * in escrow. Tokens remain frozen until:
 *   - Merchant confirms receipt → release to LP
 *   - Timeout → dispute opens automatically
 *   - LP wins dispute → refund to LP
 *   - Merchant wins dispute → slash to merchant OR transfer to replacement LP
 *
 * This module integrates with:
 *   - Kernel Event system (emits events on every state change)
 *   - Kernel Proposal system (escrow freeze is a proposal activation)
 *   - Protocol Obligation system (escrow creates a 'deliver' obligation)
 *   - Protocol Dispute engine (disputes operate on escrow entries)
 *   - Protocol Collateral Vault (slashing triggers collateral slash)
 *
 * Lifecycle:
 *   created → frozen → (released | disputed → (refunded | slashed | transferred))
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type EscrowState =
  | 'created'
  | 'frozen'
  | 'releasing'
  | 'released'
  | 'disputed'
  | 'slashed'
  | 'refunded'
  | 'transferred'
  | 'expired';

export type EscrowTransition =
  | 'freeze'
  | 'release'
  | 'dispute'
  | 'refund'
  | 'slash'
  | 'transfer'
  | 'expire';

export interface EscrowEntry {
  id: string;
  transactionId: string;
  lpId: string;
  merchantId: string;
  amount: number;
  currency: string;
  twinTokenAmount: number;
  state: EscrowState;
  frozenAt: number;
  releasedAt: number | null;
  disputeId: string | null;
  proofHash: string | null;
  replacementLpId: string | null;
  expiresAt: number;
  history: { from: EscrowState; to: EscrowState; transition: EscrowTransition; ts: number; reason: string }[];
}

/** Allowed transitions per current state. */
const ALLOWED_TRANSITIONS: Record<EscrowState, EscrowTransition[]> = {
  created: ['freeze'],
  frozen: ['release', 'dispute', 'expire'],
  releasing: ['release'],
  released: [],
  disputed: ['refund', 'slash', 'transfer'],
  slashed: [],
  refunded: [],
  transferred: [],
  expired: [],
};

export class SettlementEscrow {
  private entries: Map<string, EscrowEntry> = new Map();

  /** Freeze Twin Tokens for a transaction. This is the guarantee. */
  freeze(
    transactionId: string,
    lpId: string,
    merchantId: string,
    amount: number,
    currency: string,
    twinTokenAmount: number,
    ttlMs: number = 600000,
  ): EscrowEntry {
    const entry: EscrowEntry = {
      id: uid('escrow'),
      transactionId,
      lpId,
      merchantId,
      amount,
      currency,
      twinTokenAmount,
      state: 'frozen',
      frozenAt: Date.now(),
      releasedAt: null,
      disputeId: null,
      proofHash: null,
      replacementLpId: null,
      expiresAt: Date.now() + ttlMs,
      history: [],
    };
    this.entries.set(entry.id, entry);
    entry.history.push({ from: 'created', to: 'frozen', transition: 'freeze', ts: Date.now(), reason: 'Twin tokens frozen for transaction' });
    eventEngine.emit('escrow.frozen', { escrowId: entry.id, transactionId, lpId, merchantId, amount, twinTokenAmount }, 0);
    return entry;
  }

  /** Release escrow to LP (normal settlement — merchant confirmed). */
  release(escrowId: string, proofHash?: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'release')) return null;
    const oldState = entry.state;
    entry.state = 'released';
    entry.releasedAt = Date.now();
    entry.proofHash = proofHash ?? null;
    entry.history.push({ from: oldState, to: 'released', transition: 'release', ts: Date.now(), reason: `Settlement confirmed${proofHash ? ` (proof: ${proofHash})` : ''}` });
    eventEngine.emit('escrow.released', { escrowId, lpId: entry.lpId, proofHash }, 0);
    return entry;
  }

  /** Mark escrow as disputed. */
  dispute(escrowId: string, disputeId: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'dispute')) return null;
    this.transition(entry, 'disputed', 'dispute', `Dispute ${disputeId} opened`);
    entry.disputeId = disputeId;
    eventEngine.emit('escrow.disputed', { escrowId, disputeId }, 0);
    return entry;
  }

  /** Refund escrow to LP (LP wins dispute). */
  refund(escrowId: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'refund')) return null;
    this.transition(entry, 'refunded', 'refund', 'LP won dispute — escrow refunded');
    entry.releasedAt = Date.now();
    eventEngine.emit('escrow.refunded', { escrowId, lpId: entry.lpId }, 0);
    return entry;
  }

  /** Slash escrow to merchant (merchant wins dispute). */
  slash(escrowId: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'slash')) return null;
    this.transition(entry, 'slashed', 'slash', 'Merchant won dispute — escrow slashed');
    entry.releasedAt = Date.now();
    eventEngine.emit('escrow.slashed', { escrowId, merchantId: entry.merchantId }, 0);
    return entry;
  }

  /** Transfer escrow to a replacement LP (merchant wins + requests replacement). */
  transfer(escrowId: string, newLpId: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'transfer')) return null;
    this.transition(entry, 'transferred', 'transfer', `Escrow transferred to replacement LP ${newLpId}`);
    entry.replacementLpId = newLpId;
    entry.releasedAt = Date.now();
    eventEngine.emit('escrow.transferred', { escrowId, oldLpId: entry.lpId, newLpId }, 0);
    return entry;
  }

  /** Expire escrow (timeout without settlement). */
  expire(escrowId: string): EscrowEntry | null {
    const entry = this.entries.get(escrowId);
    if (!entry || !this.canTransition(entry, 'expire')) return null;
    this.transition(entry, 'expired', 'expire', 'Escrow expired — settlement timeout');
    eventEngine.emit('escrow.expired', { escrowId, transactionId: entry.transactionId }, 0);
    return entry;
  }

  /** Check if escrow has expired (and auto-expire it). */
  checkExpiry(escrowId: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'frozen') return false;
    if (now >= entry.expiresAt) {
      this.expire(escrowId);
      return true;
    }
    return false;
  }

  get(escrowId: string): EscrowEntry | undefined {
    return this.entries.get(escrowId);
  }

  getByTransaction(transactionId: string): EscrowEntry | undefined {
    return [...this.entries.values()].find((e) => e.transactionId === transactionId);
  }

  all(): EscrowEntry[] {
    return [...this.entries.values()];
  }

  frozen(): EscrowEntry[] {
    return this.all().filter((e) => e.state === 'frozen');
  }

  /** Total frozen value across all entries. */
  totalFrozen(currency?: string): number {
    return this.frozen()
      .filter((e) => !currency || e.currency === currency)
      .reduce((sum, e) => sum + e.twinTokenAmount, 0);
  }

  reset(): void {
    this.entries.clear();
  }

  private canTransition(entry: EscrowEntry, transition: EscrowTransition): boolean {
    return ALLOWED_TRANSITIONS[entry.state]?.includes(transition) ?? false;
  }

  private transition(entry: EscrowEntry, toState: EscrowState, transitionName: EscrowTransition, reason: string): void {
    const fromState = entry.state;
    entry.state = toState;
    entry.history.push({
      from: fromState,
      to: toState,
      transition: transitionName,
      ts: Date.now(),
      reason,
    });
  }
}

/** Singleton instance — the protocol's escrow. */
export const settlementEscrow = new SettlementEscrow();
