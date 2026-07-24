/**
 * PaySwap Protocol — Merchant Trust Tiers.
 *
 * Merchants are first-class protocol actors with trust tiers. Tier determines:
 *   - Routing priority (higher tier = prioritized)
 *   - Settlement confidence (higher tier = faster settlement)
 *   - Dispute weight (higher tier = more voting power)
 *   - Claim speed (higher tier = faster dispute processing)
 *   - Required bond (higher tier = larger bond)
 *
 * Merchants can be penalized for fraudulent claims (bond slashed).
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type MerchantTier = 'unverified' | 'verified' | 'trusted' | 'premium';

export interface MerchantRecord {
  id: string;
  name: string;
  country: string;
  currency: string;
  tier: MerchantTier;
  bond: number;
  bondEscrowed: number;
  reputation: number;
  volume: number;
  fraudHistory: number;
  refundRate: number;
  chargebackRate: number;
  avgSettlementDelayMs: number;
  complianceLevel: string;
  registeredAt: number;
  history: { action: string; ts: number; detail: string }[];
}

export interface TierConfig {
  tier: MerchantTier;
  minBond: number;
  routingPriority: number;
  disputeWeight: number;
  claimSpeed: 'slow' | 'normal' | 'fast' | 'instant';
  settlementConfidence: number;
  requiredCollateralReduction: number;
}

export const TIER_CONFIGS: Record<MerchantTier, TierConfig> = {
  unverified: { tier: 'unverified', minBond: 0, routingPriority: 0.3, disputeWeight: 0.1, claimSpeed: 'slow', settlementConfidence: 0.5, requiredCollateralReduction: 0 },
  verified: { tier: 'verified', minBond: 1000, routingPriority: 0.6, disputeWeight: 0.3, claimSpeed: 'normal', settlementConfidence: 0.7, requiredCollateralReduction: 0.1 },
  trusted: { tier: 'trusted', minBond: 5000, routingPriority: 0.85, disputeWeight: 0.6, claimSpeed: 'fast', settlementConfidence: 0.9, requiredCollateralReduction: 0.2 },
  premium: { tier: 'premium', minBond: 20000, routingPriority: 1.0, disputeWeight: 1.0, claimSpeed: 'instant', settlementConfidence: 0.98, requiredCollateralReduction: 0.3 },
};

export class MerchantRegistry {
  private merchants: Map<string, MerchantRecord> = new Map();

  /** Register a new merchant. */
  register(id: string, name: string, country: string, currency: string, bond: number = 0): MerchantRecord {
    const tier = this.tierFromBond(bond);
    const merchant: MerchantRecord = {
      id, name, country, currency,
      tier, bond, bondEscrowed: bond,
      reputation: 0.5, volume: 0, fraudHistory: 0,
      refundRate: 0, chargebackRate: 0, avgSettlementDelayMs: 0,
      complianceLevel: 'basic',
      registeredAt: Date.now(),
      history: [],
    };
    this.merchants.set(id, merchant);
    merchant.history.push({ action: 'register', ts: Date.now(), detail: `Registered with bond ${bond} (${tier})` });
    eventEngine.emit('merchant.registered', { merchantId: id, tier, bond }, 0);
    return merchant;
  }

  /** Upgrade merchant tier by increasing bond. */
  upgradeTier(merchantId: string, newBond: number): MerchantRecord | null {
    const m = this.merchants.get(merchantId);
    if (!m || newBond < m.bond) return null;
    const oldTier = m.tier;
    m.bond = newBond;
    m.bondEscrowed = newBond;
    m.tier = this.tierFromBond(newBond);
    if (oldTier !== m.tier) {
      m.history.push({ action: 'tier_upgrade', ts: Date.now(), detail: `${oldTier} → ${m.tier} (bond: ${newBond})` });
      eventEngine.emit('merchant.tier_upgraded', { merchantId, oldTier, newTier: m.tier, bond: newBond }, 0);
    }
    return m;
  }

  /** Slash merchant bond (fraudulent claim). */
  slashBond(merchantId: string, slashAmount: number, reason: string): MerchantRecord | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const actualSlash = Math.min(slashAmount, m.bondEscrowed);
    m.bondEscrowed = round(m.bondEscrowed - actualSlash, 6);
    m.fraudHistory++;
    m.reputation = Math.max(0, round(m.reputation - 0.15, 4));
    m.history.push({ action: 'bond_slashed', ts: Date.now(), detail: `Slashed ${actualSlash}: ${reason}` });
    // Downgrade tier if bond drops below threshold
    const newTier = this.tierFromBond(m.bondEscrowed);
    if (newTier !== m.tier) {
      m.tier = newTier;
      m.history.push({ action: 'tier_downgraded', ts: Date.now(), detail: `Downgraded to ${newTier} (bond: ${m.bondEscrowed})` });
    }
    eventEngine.emit('merchant.bond_slashed', { merchantId, slashAmount: actualSlash, reason, newTier: m.tier }, 0);
    return m;
  }

  /** Record a successful settlement (updates volume + reputation). */
  recordSettlement(merchantId: string, amount: number, delayMs: number): MerchantRecord | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    m.volume = round(m.volume + amount, 6);
    m.avgSettlementDelayMs = m.avgSettlementDelayMs === 0 ? delayMs : round((m.avgSettlementDelayMs + delayMs) / 2, 0);
    m.reputation = Math.min(1, round(m.reputation + 0.01, 4));
    return m;
  }

  /** Get tier configuration. */
  getTierConfig(tier: MerchantTier): TierConfig { return TIER_CONFIGS[tier]; }
  getTierConfigForMerchant(merchantId: string): TierConfig | null {
    const m = this.merchants.get(merchantId);
    return m ? TIER_CONFIGS[m.tier] : null;
  }

  get(merchantId: string): MerchantRecord | undefined { return this.merchants.get(merchantId); }
  all(): MerchantRecord[] { return [...this.merchants.values()]; }
  byTier(tier: MerchantTier): MerchantRecord[] { return this.all().filter((m) => m.tier === tier); }

  reset(): void { this.merchants.clear(); }

  private tierFromBond(bond: number): MerchantTier {
    if (bond >= 20000) return 'premium';
    if (bond >= 5000) return 'trusted';
    if (bond >= 1000) return 'verified';
    return 'unverified';
  }
}

export const merchantRegistry = new MerchantRegistry();
