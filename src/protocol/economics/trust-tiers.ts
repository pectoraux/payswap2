/**
 * PaySwap Protocol — Merchant Trust Tiers.
 *
 * Merchants are protocol actors with trust tiers. Tier determines routing
 * priority, settlement confidence, dispute weight, and claim speed.
 */
export type MerchantTier = 'unverified' | 'verified' | 'trusted' | 'premium';

export interface TrustTierConfig {
  tier: MerchantTier;
  minBond: number;
  routingPriority: number;    // 0..1 (higher = prioritized)
  disputeWeight: number;      // 0..1 (voting weight in disputes)
  claimSpeed: 'slow' | 'normal' | 'fast' | 'instant';
  settlementConfidence: number; // 0..1
}

export const TRUST_TIERS: Record<MerchantTier, TrustTierConfig> = {
  unverified: { tier: 'unverified', minBond: 0, routingPriority: 0.3, disputeWeight: 0.1, claimSpeed: 'slow', settlementConfidence: 0.5 },
  verified: { tier: 'verified', minBond: 1000, routingPriority: 0.6, disputeWeight: 0.3, claimSpeed: 'normal', settlementConfidence: 0.7 },
  trusted: { tier: 'trusted', minBond: 5000, routingPriority: 0.85, disputeWeight: 0.6, claimSpeed: 'fast', settlementConfidence: 0.9 },
  premium: { tier: 'premium', minBond: 20000, routingPriority: 1.0, disputeWeight: 1.0, claimSpeed: 'instant', settlementConfidence: 0.98 },
};

/** Determine tier from bond amount. */
export function tierFromBond(bond: number): MerchantTier {
  if (bond >= 20000) return 'premium';
  if (bond >= 5000) return 'trusted';
  if (bond >= 1000) return 'verified';
  return 'unverified';
}

/** Get tier configuration. */
export function getTierConfig(tier: MerchantTier): TrustTierConfig {
  return TRUST_TIERS[tier];
}
