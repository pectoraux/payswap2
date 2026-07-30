/**
 * Loyalty & Rewards Extension — Domain Store + Logic.
 *
 * In-memory store of customers, tiers, points awards, and coupons.
 * globalThis pattern preserves state across HMR. Money is used for lifetime
 * value (exact BigInt, no float).
 */

import { uid } from '@/runtime/types';
import { Money, money } from '@/money';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TierCode = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface Tier {
  code: TierCode;
  name: string;
  threshold: Money;            // lifetime value at which tier unlocks
  pointsMultiplier: number;    // multiplier on awarded points
  perks: string[];
}

export interface PointsAward {
  id: string;
  customerId: string;
  points: number;              // positive = award, negative = redeem
  reason: string;              // 'purchase' | 'signup' | 'delivery' | 'redeem' | 'manual'
  referenceId?: string;        // saleId, paymentId, deliveryId, couponId
  createdAt: number;
}

export type CouponStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED';

export interface Coupon {
  id: string;
  code: string;
  customerId: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;       // percentage (0-100) or fixed USD amount
  discountMoney?: Money;       // exact Money for FIXED coupons
  status: CouponStatus;
  expiresAt: number;
  createdAt: number;
  redeemedAt?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: TierCode;
  points: number;              // current balance
  lifetimeValue: Money;        // exact — drives tier upgrades
  joinedAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

interface LoyaltyStore {
  customers: Map<string, Customer>;
  tiers: Map<TierCode, Tier>;
  awards: PointsAward[];
  coupons: Map<string, Coupon>;
}

const globalForLoyalty = globalThis as unknown as { __LOYALTY_STORE__?: LoyaltyStore };

const store: LoyaltyStore = globalForLoyalty.__LOYALTY_STORE__ ?? {
  customers: new Map(),
  tiers: new Map(),
  awards: [],
  coupons: new Map(),
};

if (!globalForLoyalty.__LOYALTY_STORE__) {
  globalForLoyalty.__LOYALTY_STORE__ = store;
  seedTiers();
}

// Point earning rates per the spec
export const POINTS_RULES = {
  PAYMENT_PER_DOLLAR: 1,       // payment.completed → 1 pt/$
  SALE_PER_DOLLAR: 5,          // sale.completed → 5 pt/$
  DELIVERY_BONUS: 10,          // delivery.delivered → 10 bonus pts
  SIGNUP_WELCOME: 50,          // customer.signup → 50 welcome pts
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const loyaltyService = {
  // ── Tiers ──
  listTiers(): Tier[] {
    return Array.from(store.tiers.values()).sort((a, b) =>
      a.threshold.compare(b.threshold));
  },
  getTier(code: TierCode): Tier | undefined { return store.tiers.get(code); },

  // ── Customers ──
  registerCustomer(input: { id: string; name: string; email: string }): Customer {
    const existing = store.customers.get(input.id);
    if (existing) return existing;
    const customer: Customer = {
      id: input.id, name: input.name, email: input.email,
      tier: 'BRONZE', points: 0, lifetimeValue: money.usd(0),
      joinedAt: Date.now(), updatedAt: Date.now(),
    };
    store.customers.set(input.id, customer);
    return customer;
  },
  getCustomer(id: string): Customer | undefined { return store.customers.get(id); },
  listCustomers(): Customer[] {
    return Array.from(store.customers.values()).sort((a, b) => b.joinedAt - a.joinedAt);
  },

  // ── Points ──
  awardPoints(input: {
    customerId: string; points: number; reason: string; referenceId?: string;
  }): { customer: Customer; award: PointsAward; tierUpgraded: boolean; newTier?: TierCode } {
    const customer = store.customers.get(input.customerId);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);
    if (input.points <= 0) throw new Error('Award points must be positive');
    const tier = store.tiers.get(customer.tier);
    const multiplier = tier?.pointsMultiplier ?? 1;
    const effectivePoints = Math.round(input.points * multiplier);
    customer.points += effectivePoints;
    customer.updatedAt = Date.now();
    const award: PointsAward = {
      id: uid('award'), customerId: customer.id,
      points: effectivePoints, reason: input.reason,
      referenceId: input.referenceId, createdAt: Date.now(),
    };
    store.awards.push(award);
    if (store.awards.length > 5000) store.awards.length = 5000;
    return { customer, award, tierUpgraded: false };
  },

  /** Award points AND increase lifetime value (used for purchase events). */
  awardPointsForSpend(input: {
    customerId: string; spend: Money; pointsPerDollar: number; reason: string; referenceId?: string;
  }): { customer: Customer; award: PointsAward; tierUpgraded: boolean; newTier?: TierCode } {
    const customer = store.customers.get(input.customerId);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);
    // Update LTV (exact Money)
    customer.lifetimeValue = customer.lifetimeValue.add(input.spend);
    // Award points based on dollar value of spend (rounded down)
    const dollars = Math.floor(input.spend.toNumber());
    const basePoints = dollars * input.pointsPerDollar;
    const result = loyaltyService.awardPoints({
      customerId: customer.id, points: basePoints, reason: input.reason, referenceId: input.referenceId,
    });
    // Now check tier upgrade based on LTV
    const upgrade = loyaltyService.checkTierUpgrade(customer.id);
    return { ...result, tierUpgraded: upgrade.upgraded, newTier: upgrade.newTier };
  },

  redeemPoints(input: {
    customerId: string; points: number; reason?: string;
  }): { customer: Customer; award: PointsAward } {
    const customer = store.customers.get(input.customerId);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);
    if (input.points <= 0) throw new Error('Redeem points must be positive');
    if (customer.points < input.points) {
      throw new Error(`Insufficient points: requested ${input.points}, balance ${customer.points}`);
    }
    customer.points -= input.points;
    customer.updatedAt = Date.now();
    const award: PointsAward = {
      id: uid('award'), customerId: customer.id,
      points: -input.points, reason: input.reason ?? 'redeem',
      createdAt: Date.now(),
    };
    store.awards.push(award);
    return { customer, award };
  },

  // ── Tier upgrades ──
  checkTierUpgrade(customerId: string): { upgraded: boolean; newTier?: TierCode; previousTier?: TierCode } {
    const customer = store.customers.get(customerId);
    if (!customer) return { upgraded: false };
    const tiers = loyaltyService.listTiers(); // sorted ascending by threshold
    let newTier: TierCode = customer.tier;
    for (const t of tiers) {
      if (customer.lifetimeValue.greaterThanOrEqual(t.threshold)) newTier = t.code;
    }
    if (newTier !== customer.tier && tiers.find((t) => t.code === newTier)) {
      const previousTier = customer.tier;
      customer.tier = newTier;
      customer.updatedAt = Date.now();
      return { upgraded: true, newTier, previousTier };
    }
    return { upgraded: false };
  },

  // ── Coupons ──
  issueCoupon(input: {
    customerId: string; description: string;
    discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number;
    expiresAt: number;
  }): Coupon {
    const customer = store.customers.get(input.customerId);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);
    const coupon: Coupon = {
      id: uid('cpn'),
      code: `LOYAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerId: customer.id,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discountMoney: input.discountType === 'FIXED' ? money.usd(input.discountValue) : undefined,
      status: 'ACTIVE',
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
    };
    store.coupons.set(coupon.id, coupon);
    return coupon;
  },

  redeemCoupon(couponId: string): Coupon | null {
    const c = store.coupons.get(couponId);
    if (!c || c.status !== 'ACTIVE') return null;
    if (c.expiresAt < Date.now()) { c.status = 'EXPIRED'; return null; }
    c.status = 'REDEEMED'; c.redeemedAt = Date.now();
    return c;
  },

  listCoupons(customerId?: string): Coupon[] {
    let rows = Array.from(store.coupons.values());
    if (customerId) rows = rows.filter((c) => c.customerId === customerId);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Balance ──
  getBalance(customerId: string): {
    customer: Customer; tier: Tier; recentAwards: PointsAward[];
  } | null {
    const customer = store.customers.get(customerId);
    if (!customer) return null;
    const tier = store.tiers.get(customer.tier)!;
    const recentAwards = store.awards
      .filter((a) => a.customerId === customerId)
      .slice(-10)
      .reverse();
    return { customer, tier, recentAwards };
  },

  // ── Stats / Health ──
  stats() {
    const customers = Array.from(store.customers.values());
    return {
      totalCustomers: customers.length,
      totalPointsOutstanding: customers.reduce((s, c) => s + c.points, 0),
      activeCoupons: Array.from(store.coupons.values()).filter((c) => c.status === 'ACTIVE').length,
      tierBreakdown: {
        BRONZE: customers.filter((c) => c.tier === 'BRONZE').length,
        SILVER: customers.filter((c) => c.tier === 'SILVER').length,
        GOLD: customers.filter((c) => c.tier === 'GOLD').length,
        PLATINUM: customers.filter((c) => c.tier === 'PLATINUM').length,
      },
      totalLifetimeValue: customers.length > 0
        ? Money.sum(customers.map((c) => c.lifetimeValue)).toJSON()
        : money.usd(0).toJSON(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED — 4 tiers (BRONZE/SILVER/GOLD/PLATINUM)
// ═══════════════════════════════════════════════════════════════════════════

function seedTiers() {
  const tiers: Tier[] = [
    { code: 'BRONZE', name: 'Bronze', threshold: money.usd(0), pointsMultiplier: 1.0, perks: ['Welcome bonus', 'Birthday gift'] },
    { code: 'SILVER', name: 'Silver', threshold: money.usd(500), pointsMultiplier: 1.25, perks: ['5% off coupons', 'Free shipping'] },
    { code: 'GOLD', name: 'Gold', threshold: money.usd(2000), pointsMultiplier: 1.5, perks: ['10% off coupons', 'Priority support', 'Early access'] },
    { code: 'PLATINUM', name: 'Platinum', threshold: money.usd(10000), pointsMultiplier: 2.0, perks: ['20% off coupons', 'Dedicated account manager', 'Exclusive events'] },
  ];
  for (const t of tiers) store.tiers.set(t.code, t);
}
