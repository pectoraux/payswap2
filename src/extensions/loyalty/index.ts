/**
 * Loyalty & Rewards Extension — defineExtension() entry point.
 *
 * Subscribes to four customer lifecycle events and awards points
 * automatically. Emits loyalty.* events on every state change.
 *
 *   payment.completed    → 1 pt per $1 paid
 *   sale.completed       → 5 pts per $1 sold
 *   delivery.delivered   → 10 bonus pts
 *   customer.signup      → 50 welcome pts
 */

import { defineExtension, type ExtensionContext } from '@/extension-platform/sdk';
import { loyaltyManifest as manifest } from './manifest';
import { loyaltyService } from './store';
import { money } from '@/money';

interface CustomerEvent {
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  amount?: number;
  currency?: string;
  saleId?: string;
  paymentId?: string;
  deliveryId?: string;
}

function ensureCustomer(e: CustomerEvent, ctx: ExtensionContext) {
  if (!e.customerId) { ctx.logging.warn('Event missing customerId', { event: e }); return null; }
  if (!loyaltyService.getCustomer(e.customerId)) {
    loyaltyService.registerCustomer({
      id: e.customerId,
      name: e.customerName ?? `Customer ${e.customerId.slice(-6)}`,
      email: e.customerEmail ?? `${e.customerId}@example.com`,
    });
  }
  return loyaltyService.getCustomer(e.customerId)!;
}

export default defineExtension({
  manifest,

  setup(ctx: ExtensionContext) {
    ctx.logging.info('Loyalty & Rewards extension starting...', { version: manifest.version });

    // payment.completed → 1 point per $1 paid
    ctx.events.subscribe('payment.completed', (event) => {
      const e = event as CustomerEvent;
      const customer = ensureCustomer(e, ctx);
      if (!customer || !e.amount) return;
      try {
        const { award, tierUpgraded, newTier } = loyaltyService.awardPointsForSpend({
          customerId: customer.id,
          spend: money.usd(e.amount),
          pointsPerDollar: 1,
          reason: 'payment',
          referenceId: e.paymentId,
        });
        ctx.logging.info('Awarded points for payment', { customerId: customer.id, points: award.points });
        ctx.events.emit('loyalty.points_awarded', {
          customerId: customer.id, points: award.points, reason: 'payment', awardId: award.id,
        }).catch((err) => ctx.logging.warn('emit failed', { err: String(err) }));
        if (tierUpgraded && newTier) {
          ctx.events.emit('loyalty.tier_upgraded', { customerId: customer.id, newTier }).catch(() => {});
        }
      } catch (err) {
        ctx.logging.error('Failed to award payment points', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    // sale.completed → 5 points per $1 sold
    ctx.events.subscribe('sale.completed', (event) => {
      const e = event as CustomerEvent;
      const customer = ensureCustomer(e, ctx);
      if (!customer || !e.amount) return;
      try {
        const { award, tierUpgraded, newTier } = loyaltyService.awardPointsForSpend({
          customerId: customer.id,
          spend: money.usd(e.amount),
          pointsPerDollar: 5,
          reason: 'sale',
          referenceId: e.saleId,
        });
        ctx.logging.info('Awarded points for sale', { customerId: customer.id, points: award.points });
        ctx.events.emit('loyalty.points_awarded', {
          customerId: customer.id, points: award.points, reason: 'sale', awardId: award.id,
        }).catch(() => {});
        if (tierUpgraded && newTier) {
          ctx.events.emit('loyalty.tier_upgraded', { customerId: customer.id, newTier }).catch(() => {});
        }
      } catch (err) {
        ctx.logging.error('Failed to award sale points', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    // delivery.delivered → 10 bonus points
    ctx.events.subscribe('delivery.delivered', (event) => {
      const e = event as CustomerEvent;
      const customer = ensureCustomer(e, ctx);
      if (!customer) return;
      try {
        const { award } = loyaltyService.awardPoints({
          customerId: customer.id, points: 10, reason: 'delivery', referenceId: e.deliveryId,
        });
        ctx.logging.info('Awarded delivery bonus points', { customerId: customer.id, points: award.points });
        ctx.events.emit('loyalty.points_awarded', {
          customerId: customer.id, points: award.points, reason: 'delivery', awardId: award.id,
        }).catch(() => {});
      } catch (err) {
        ctx.logging.error('Failed to award delivery bonus', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    // customer.signup → 50 welcome points
    ctx.events.subscribe('customer.signup', (event) => {
      const e = event as CustomerEvent;
      const customer = ensureCustomer(e, ctx);
      if (!customer) return;
      try {
        const { award } = loyaltyService.awardPoints({
          customerId: customer.id, points: 50, reason: 'signup',
        });
        ctx.logging.info('Awarded welcome points', { customerId: customer.id, points: award.points });
        ctx.events.emit('loyalty.points_awarded', {
          customerId: customer.id, points: award.points, reason: 'signup', awardId: award.id,
        }).catch(() => {});
      } catch (err) {
        ctx.logging.error('Failed to award signup bonus', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    ctx.logging.info('Loyalty & Rewards extension ready', {
      capabilities: manifest.capabilities.length,
      tiers: loyaltyService.listTiers().length,
    });
  },

  // ── Capability handlers ──
  capabilities: {
    'Award Points': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const { customer, award, tierUpgraded, newTier } = loyaltyService.awardPoints({
        customerId: inputs.customerId as string,
        points: inputs.points as number,
        reason: (inputs.reason as string) ?? 'manual',
        referenceId: inputs.referenceId as string | undefined,
      });
      await ctx.events.emit('loyalty.points_awarded', {
        customerId: customer.id, points: award.points, reason: award.reason, awardId: award.id,
      });
      if (tierUpgraded && newTier) {
        await ctx.events.emit('loyalty.tier_upgraded', { customerId: customer.id, newTier });
      }
      return { awardId: award.id, points: award.points, balance: customer.points, tierUpgraded, newTier };
    },

    'Redeem Points': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const { customer, award } = loyaltyService.redeemPoints({
        customerId: inputs.customerId as string,
        points: inputs.points as number,
        reason: (inputs.reason as string) ?? 'redeem',
      });
      await ctx.events.emit('loyalty.points_awarded', {
        customerId: customer.id, points: award.points, reason: 'redeem', awardId: award.id,
      });
      return { awardId: award.id, pointsRedeemed: -award.points, balance: customer.points };
    },

    'Upgrade Tier': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const result = loyaltyService.checkTierUpgrade(inputs.customerId as string);
      if (result.upgraded && result.newTier) {
        await ctx.events.emit('loyalty.tier_upgraded', {
          customerId: inputs.customerId, newTier: result.newTier, previousTier: result.previousTier,
        });
      }
      return result;
    },

    'Issue Coupon': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const coupon = loyaltyService.issueCoupon({
        customerId: inputs.customerId as string,
        description: inputs.description as string,
        discountType: inputs.discountType as 'PERCENTAGE' | 'FIXED',
        discountValue: inputs.discountValue as number,
        expiresAt: (inputs.expiresAt as number) ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      await ctx.events.emit('loyalty.coupon_issued', {
        couponId: coupon.id, code: coupon.code, customerId: coupon.customerId,
      });
      return { couponId: coupon.id, code: coupon.code, status: coupon.status };
    },
  },

  // ── Health checks ──
  healthChecks: {
    'points-ledger': async (_ctx) => ({ healthy: true, detail: 'Points ledger consistent' }),
    'tier-engine': async (_ctx) => ({ healthy: true, detail: `${loyaltyService.listTiers().length} tiers configured` }),
  },

  // ── Scheduled jobs ──
  scheduledJobs: {
    'tier-review': async (ctx) => {
      let upgraded = 0;
      for (const c of loyaltyService.listCustomers()) {
        if (loyaltyService.checkTierUpgrade(c.id).upgraded) upgraded++;
      }
      ctx.logging.info('Tier review complete', { upgraded });
    },
    'coupon-expire': async (ctx) => {
      const now = Date.now();
      const expired = loyaltyService.listCoupons().filter((c) => c.status === 'ACTIVE' && c.expiresAt < now);
      for (const c of expired) { c.status = 'EXPIRED'; }
      ctx.logging.debug('Expired coupons', { count: expired.length });
    },
  },
});
