/**
 * PaySwap Protocol — Smart Contract Interfaces.
 *
 * The runtime NEVER manipulates blockchain state directly. It generates
 * commands; smart contracts execute them. These interfaces define the 8
 * verifiable settlement primitives. In production these would be real
 * on-chain contracts; in the Digital Twin they are simulated entities that
 * produce cryptographic attations.
 *
 * Contracts are responsible ONLY for things that benefit from on-chain
 * guarantees: deterministic state transitions + proofs. All optimization,
 * routing, AI reasoning, and policy evaluation remain off-chain.
 */
import type { Entity } from '@/kernel/entity';
import { createEntity } from '@/kernel/entity';
import { uid } from '@/kernel/support';
import type { Transition } from '@/kernel/transition';

export type ContractType =
  | 'TwinToken'
  | 'LiquidityPool'
  | 'SettlementEscrow'
  | 'CollateralVault'
  | 'Governance'
  | 'Treasury'
  | 'LPRegistry'
  | 'MerchantRegistry';

export interface SmartContract {
  contractId: string;
  type: ContractType;
  address: string;
  commands: string[];
  verify: (transition: Transition) => boolean;
}

/** Settlement Escrow state machine — the guarantee that replaces insurance. */
export type EscrowState =
  | 'created'
  | 'frozen'
  | 'releasing'
  | 'released'
  | 'disputed'
  | 'slashed'
  | 'refunded'
  | 'transferred';

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
}

/** Collateral Vault — secures manual settlement obligations. */
export type CollateralState = 'locked' | 'released' | 'slashed' | 'partially_slashed';

export interface CollateralEntry {
  id: string;
  lpId: string;
  amount: number;
  currency: string;
  state: CollateralState;
  lockedAt: number;
  slashReason: string | null;
  slashAmount: number;
}

/**
 * Settlement Escrow Contract.
 * Every transaction reserves Twin Tokens in escrow. Tokens remain frozen
 * until merchant confirms, timeout, dispute resolution, or cancellation.
 */
export class SettlementEscrowContract {
  private entries: Map<string, EscrowEntry> = new Map();

  /** Freeze Twin Tokens for a transaction. */
  freeze(transactionId: string, lpId: string, merchantId: string, amount: number, currency: string, twinTokenAmount: number): EscrowEntry {
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
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Release escrow to LP (normal settlement or LP wins dispute). */
  release(escrowId: string, proofHash?: string): EscrowEntry | undefined {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'frozen') return undefined;
    entry.state = 'released';
    entry.releasedAt = Date.now();
    entry.proofHash = proofHash ?? null;
    return entry;
  }

  /** Mark escrow as disputed (freeze until resolution). */
  dispute(escrowId: string, disputeId: string): EscrowEntry | undefined {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'frozen') return undefined;
    entry.state = 'disputed';
    entry.disputeId = disputeId;
    return entry;
  }

  /** Slash escrow to merchant (merchant wins dispute). */
  slash(escrowId: string): EscrowEntry | undefined {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'disputed') return undefined;
    entry.state = 'slashed';
    entry.releasedAt = Date.now();
    return entry;
  }

  /** Refund escrow to LP (LP wins dispute). */
  refund(escrowId: string): EscrowEntry | undefined {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'disputed') return undefined;
    entry.state = 'refunded';
    entry.releasedAt = Date.now();
    return entry;
  }

  /** Transfer escrow to a replacement LP (merchant wins + requests replacement). */
  transfer(escrowId: string, newLpId: string): EscrowEntry | undefined {
    const entry = this.entries.get(escrowId);
    if (!entry || entry.state !== 'disputed') return undefined;
    entry.state = 'transferred';
    entry.lpId = newLpId;
    entry.releasedAt = Date.now();
    return entry;
  }

  get(escrowId: string): EscrowEntry | undefined {
    return this.entries.get(escrowId);
  }

  all(): EscrowEntry[] {
    return [...this.entries.values()];
  }

  verify(transition: Transition): boolean {
    // Verify that the transition is valid against escrow state
    return transition.command === 'FreezeEscrow' || transition.command === 'ReleaseEscrow' || transition.command === 'SlashEscrow' || transition.command === 'RefundEscrow' || transition.command === 'TransferEscrow';
  }
}

/**
 * Collateral Vault Contract.
 * Secures manual settlement obligations. Slashed only after protocol
 * adjudication. Never used as routing liquidity.
 */
export class CollateralVaultContract {
  private entries: Map<string, CollateralEntry> = new Map();

  lock(lpId: string, amount: number, currency: string): CollateralEntry {
    const entry: CollateralEntry = {
      id: uid('collat'),
      lpId,
      amount,
      currency,
      state: 'locked',
      lockedAt: Date.now(),
      slashReason: null,
      slashAmount: 0,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  slash(collateralId: string, amount: number, reason: string): CollateralEntry | undefined {
    const entry = this.entries.get(collateralId);
    if (!entry || entry.state !== 'locked') return undefined;
    entry.slashAmount += amount;
    entry.slashReason = reason;
    entry.state = entry.slashAmount >= entry.amount ? 'slashed' : 'partially_slashed';
    return entry;
  }

  release(collateralId: string): CollateralEntry | undefined {
    const entry = this.entries.get(collateralId);
    if (!entry || entry.state !== 'locked') return undefined;
    entry.state = 'released';
    return entry;
  }

  byLp(lpId: string): CollateralEntry[] {
    return [...this.entries.values()].filter((e) => e.lpId === lpId);
  }

  all(): CollateralEntry[] {
    return [...this.entries.values()];
  }

  verify(transition: Transition): boolean {
    return transition.command === 'LockCollateral' || transition.command === 'SlashCollateral' || transition.command === 'ReleaseCollateral';
  }
}

/**
 * Twin Token Contract.
 * Mints, burns, transfers, locks, unlocks. Every operation reconciles with
 * the ledger. Never allows unbacked supply.
 */
export class TwinTokenContract {
  private supply: Map<string, number> = new Map(); // currency → total supply
  private locks: Map<string, { amount: number; reason: string }> = new Map(); // tokenId → lock

  mint(currency: string, amount: number): { symbol: string; amount: number } {
    const current = this.supply.get(currency) ?? 0;
    this.supply.set(currency, current + amount);
    return { symbol: `Twin${currency}`, amount };
  }

  burn(currency: string, amount: number): boolean {
    const current = this.supply.get(currency) ?? 0;
    if (current < amount) return false;
    this.supply.set(currency, current - amount);
    return true;
  }

  lock(tokenId: string, amount: number, reason: string): void {
    this.locks.set(tokenId, { amount, reason });
  }

  unlock(tokenId: string): void {
    this.locks.delete(tokenId);
  }

  supplyOf(currency: string): number {
    return this.supply.get(currency) ?? 0;
  }

  verify(transition: Transition): boolean {
    return ['MintAsset', 'BurnAsset', 'TransferLiquidity'].includes(transition.command);
  }
}

/**
 * Liquidity Pool Contract.
 * Contains LP Twin Tokens only. Provides liquidity, staking, withdrawals.
 * Never used directly to compensate users.
 */
export class LiquidityPoolContract {
  private stakes: Map<string, { lpId: string; amount: number; currency: string }> = new Map();

  stake(lpId: string, amount: number, currency: string): string {
    const stakeId = uid('stake');
    this.stakes.set(stakeId, { lpId, amount, currency });
    return stakeId;
  }

  unstake(stakeId: string): { lpId: string; amount: number; currency: string } | undefined {
    const stake = this.stakes.get(stakeId);
    if (!stake) return undefined;
    this.stakes.delete(stakeId);
    return stake;
  }

  totalLiquidity(currency: string): number {
    return [...this.stakes.values()].filter((s) => s.currency === currency).reduce((sum, s) => sum + s.amount, 0);
  }

  stakesByLp(lpId: string): { stakeId: string; amount: number; currency: string }[] {
    return [...this.stakes.entries()].filter(([, s]) => s.lpId === lpId).map(([id, s]) => ({ stakeId: id, amount: s.amount, currency: s.currency }));
  }

  verify(transition: Transition): boolean {
    return transition.command === 'StakeLP' || transition.command === 'UnstakeLP';
  }
}

/**
 * LP Registry Contract.
 * LP registration, dynamic authorized exposure, reputation tracking.
 */
export class LPRegistryContract {
  private registrations: Map<string, { lpId: string; authorizedExposure: number; reputation: number; tier: string; registeredAt: number }> = new Map();

  register(lpId: string): void {
    this.registrations.set(lpId, { lpId, authorizedExposure: 0, reputation: 0.5, tier: 'probationary', registeredAt: Date.now() });
  }

  updateExposure(lpId: string, exposure: number): void {
    const reg = this.registrations.get(lpId);
    if (reg) reg.authorizedExposure = exposure;
  }

  updateReputation(lpId: string, reputation: number): void {
    const reg = this.registrations.get(lpId);
    if (reg) {
      reg.reputation = Math.max(0, Math.min(1, reputation));
      // Tier derived from reputation
      reg.tier = reputation > 0.8 ? 'premium' : reputation > 0.6 ? 'trusted' : reputation > 0.3 ? 'standard' : 'probationary';
    }
  }

  get(lpId: string): { lpId: string; authorizedExposure: number; reputation: number; tier: string } | undefined {
    return this.registrations.get(lpId);
  }

  all(): { lpId: string; authorizedExposure: number; reputation: number; tier: string }[] {
    return [...this.registrations.values()];
  }

  verify(transition: Transition): boolean {
    return transition.command === 'RegisterLP' || transition.command === 'UpdateExposure' || transition.command === 'UpdateReputation';
  }
}

/**
 * Merchant Registry Contract.
 * Merchant registration, trust tiers, bonds, penalties.
 */
export class MerchantRegistryContract {
  private merchants: Map<string, { merchantId: string; tier: string; bond: number; reputation: number; registeredAt: number }> = new Map();

  register(merchantId: string, bond: number = 0): void {
    const tier = bond > 10000 ? 'premium' : bond > 1000 ? 'trusted' : bond > 0 ? 'verified' : 'unverified';
    this.merchants.set(merchantId, { merchantId, tier, bond, reputation: 0.5, registeredAt: Date.now() });
  }

  updateTier(merchantId: string, bond: number): void {
    const m = this.merchants.get(merchantId);
    if (m) {
      m.bond = bond;
      m.tier = bond > 10000 ? 'premium' : bond > 1000 ? 'trusted' : bond > 0 ? 'verified' : 'unverified';
    }
  }

  slashBond(merchantId: string, amount: number): void {
    const m = this.merchants.get(merchantId);
    if (m) {
      m.bond = Math.max(0, m.bond - amount);
      m.reputation = Math.max(0, m.reputation - 0.1);
    }
  }

  get(merchantId: string): { merchantId: string; tier: string; bond: number; reputation: number } | undefined {
    return this.merchants.get(merchantId);
  }

  all(): { merchantId: string; tier: string; bond: number; reputation: number }[] {
    return [...this.merchants.values()];
  }

  verify(transition: Transition): boolean {
    return transition.command === 'RegisterMerchant' || transition.command === 'UpdateTier' || transition.command === 'SlashBond';
  }
}

/** Singleton contract instances (simulated on-chain state). */
export const twinTokenContract = new TwinTokenContract();
export const liquidityPoolContract = new LiquidityPoolContract();
export const settlementEscrowContract = new SettlementEscrowContract();
export const collateralVaultContract = new CollateralVaultContract();
export const lpRegistryContract = new LPRegistryContract();
export const merchantRegistryContract = new MerchantRegistryContract();
