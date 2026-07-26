/**
 * PaySwap Runtime — Capabilities System.
 *
 * Capabilities are first-class. Every entity declares what it can do
 * (canBridge, canStake, canMint, canTransfer, canReceive, etc.). The solver
 * NEVER hardcodes finance — it asks the graph "who can perform X?" and the
 * graph answers based on declared capabilities.
 *
 * This is what makes the runtime generic. Adding a Bitcoin plugin means
 * registering a Bitcoin Reserve with canBridge, a Bitcoin Wallet with
 * canTransfer — zero kernel changes.
 *
 * Plugins register Capabilities + Rules + Commands + Policies. The kernel
 * changes zero lines.
 */
import type { Entity } from './entity';

export type Capability =
  | 'canTransfer'
  | 'canReceive'
  | 'canStake'
  | 'canWithdraw'
  | 'canBridge'
  | 'canMint'
  | 'canBurn'
  | 'canSwap'
  | 'canCredit'
  | 'canDebit'
  | 'canSettle'
  | 'canVote'
  | 'canConvert'
  | 'canRefund'
  | 'canBorrow'
  | 'canLend'
  | 'canInsure'
  | 'canClaim';

/** All known capabilities — extensible by plugins. */
export const ALL_CAPABILITIES: Capability[] = [
  'canTransfer', 'canReceive', 'canStake', 'canWithdraw', 'canBridge',
  'canMint', 'canBurn', 'canSwap', 'canCredit', 'canDebit', 'canSettle',
  'canVote', 'canConvert', 'canRefund', 'canBorrow', 'canLend', 'canInsure', 'canClaim',
];

/** Human-readable labels. */
export const CAPABILITY_LABELS: Record<string, string> = {
  canTransfer: 'Transfer',
  canReceive: 'Receive',
  canStake: 'Stake',
  canWithdraw: 'Withdraw',
  canBridge: 'Bridge',
  canMint: 'Mint',
  canBurn: 'Burn',
  canSwap: 'Swap',
  canCredit: 'Credit',
  canDebit: 'Debit',
  canSettle: 'Settle',
  canVote: 'Vote',
  canConvert: 'Convert',
  canRefund: 'Refund',
  canBorrow: 'Borrow',
  canLend: 'Lend',
  canInsure: 'Insure',
  canClaim: 'Claim',
};

/**
 * Query the entity graph for all entities that have a given capability.
 * This is the solver's primary interface — it never hardcodes "find LPs" or
 * "find reserves". It asks: "who canBridge?"
 */
export function entitiesWithCapability(entities: Entity[], cap: Capability): Entity[] {
  return entities.filter((e) => e.capabilities[cap] === true && e.state !== 'frozen' && e.state !== 'closed' && e.state !== 'slashed');
}

/**
 * Query for entities that can perform a specific capability in a given
 * country/currency context. Used by the solver to find valid liquidity paths.
 */
export function entitiesWithCapabilityIn(
  entities: Entity[],
  cap: Capability,
  country?: string,
  currency?: string,
): Entity[] {
  return entitiesWithCapability(entities, cap).filter(
    (e) =>
      (!country || e.country === country) &&
      (!currency || e.currency === currency) &&
      e.balance > 0,
  );
}

/**
 * Check if an entity can perform a capability (with optional required balance).
 */
export function canPerform(entity: Entity, cap: Capability, amount?: number): boolean {
  if (!entity.capabilities[cap]) return false;
  if (entity.state === 'frozen' || entity.state === 'closed' || entity.state === 'slashed') return false;
  if (amount != null && entity.balance < amount) return false;
  return true;
}

/**
 * Capability registry — plugins register new capabilities here.
 * The kernel starts empty; everything financial is registered as data.
 */
export class CapabilityRegistry {
  private capabilities: Map<string, { name: Capability; label: string; description: string }> = new Map();

  constructor() {
    // Bootstrap with built-in capabilities
    for (const cap of ALL_CAPABILITIES) {
      this.capabilities.set(cap, { name: cap, label: CAPABILITY_LABELS[cap] ?? cap, description: '' });
    }
  }

  register(name: string, label: string, description: string): void {
    this.capabilities.set(name, { name: name as Capability, label, description });
  }

  list(): { name: string; label: string; description: string }[] {
    return [...this.capabilities.values()];
  }

  has(name: string): boolean {
    return this.capabilities.has(name);
  }
}

export const capabilityRegistry = new CapabilityRegistry();
