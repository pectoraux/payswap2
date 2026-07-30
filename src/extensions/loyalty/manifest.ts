/**
 * Loyalty & Rewards Extension — Manifest v2.
 *
 * Points-based loyalty program with tier upgrades and coupons. Subscribes to
 * payment.completed (1 pt/$1), sale.completed (5 pts/$1), delivery.delivered
 * (10 bonus pts), and customer.signup (50 welcome pts).
 */

import type { ExtensionManifestV2 } from '@/extension-platform/types';

export const loyaltyManifest: ExtensionManifestV2 = {
  // ── Identity ──
  id: 'loyalty-rewards',
  name: 'Loyalty & Rewards',
  version: '1.0.0',
  publisher: {
    id: 'pub_engage_co',
    name: 'Engage Co',
    email: 'dev@engage.co',
    website: 'https://engage.co',
    verified: true,
  },
  description: 'Points-based loyalty program with tier upgrades and coupons. Customers earn 1 point per $1 paid, 5 points per $1 in sales, 10 bonus points per delivery, and 50 welcome points on signup. Tiers unlock perks (BRONZE → SILVER → GOLD → PLATINUM). Uses exact Money for lifetime value tracking.',
  homepage: 'https://engage.co/loyalty',
  license: 'MIT',
  repository: 'https://github.com/engage-co/loyalty',
  documentationUrl: 'https://docs.engage.co/loyalty',
  supportUrl: 'https://support.engage.co',
  category: 'ANALYTICS',
  tags: ['loyalty', 'rewards', 'points', 'tiers', 'coupons', 'retention', 'engagement'],
  screenshots: [
    'https://engage.co/screenshots/dashboard.png',
    'https://engage.co/screenshots/tiers.png',
  ],

  // ── Capabilities ──
  capabilities: [
    { name: 'Award Points', description: 'Award loyalty points to a customer for an action (purchase, signup, delivery).', category: 'loyalty', produces: ['asset.loyalty_points'], requires: [], universal: false },
    { name: 'Redeem Points', description: 'Redeem customer loyalty points for a discount or reward.', category: 'loyalty', produces: [], requires: ['asset.loyalty_points'], universal: false },
    { name: 'Upgrade Tier', description: 'Upgrade a customer to the next loyalty tier based on lifetime value.', category: 'loyalty', produces: ['asset.loyalty_tier'], requires: ['asset.loyalty_points'], universal: false },
    { name: 'Issue Coupon', description: 'Issue a coupon to a customer (manual reward or tier perk).', category: 'loyalty', produces: ['asset.coupon'], requires: [], universal: false },
  ],

  // ── Assets ──
  assets: [
    { id: 'asset.loyalty_points', name: 'Loyalty Points', type: 'CURRENCY', unit: 'point', description: 'Customer loyalty points balance.' },
    { id: 'asset.loyalty_tier', name: 'Loyalty Tier', type: 'CREDENTIAL', unit: 'tier', description: 'Customer loyalty tier (BRONZE/SILVER/GOLD/PLATINUM).' },
    { id: 'asset.coupon', name: 'Coupon', type: 'CREDENTIAL', unit: 'coupon', description: 'A discount or reward coupon.' },
  ],

  // ── Tokens ──
  tokens: [
    { symbol: 'PTS', name: 'Loyalty Points', assetId: 'asset.loyalty_points', kind: 'FUNGIBLE', consumable: true },
  ],

  // ── Events ──
  events: [
    { type: 'emits', eventType: 'loyalty.points_awarded', description: 'Points were awarded to a customer.' },
    { type: 'emits', eventType: 'loyalty.tier_upgraded', description: 'A customer was upgraded to a new tier.' },
    { type: 'emits', eventType: 'loyalty.coupon_issued', description: 'A coupon was issued to a customer.' },
    { type: 'consumes', eventType: 'payment.completed', description: 'Award 1 point per $1 paid.' },
    { type: 'consumes', eventType: 'sale.completed', description: 'Award 5 points per $1 sold.' },
    { type: 'consumes', eventType: 'delivery.delivered', description: 'Award 10 bonus points on delivery.' },
    { type: 'consumes', eventType: 'customer.signup', description: 'Award 50 welcome points on signup.' },
  ],

  // ── Providers ──
  providers: [],

  // ── Policies ──
  policies: [
    { name: 'No Negative Balance', rule: 'require_positive_balance', enforcement: 'BLOCK', description: 'Cannot redeem more points than the customer holds.' },
  ],

  // ── Routes ──
  routes: [
    { path: '/api/loyalty/award', method: 'POST', handler: 'awardPoints', authRequired: true, permissions: ['customers'] },
    { path: '/api/loyalty/redeem', method: 'POST', handler: 'redeemPoints', authRequired: true, permissions: ['customers'] },
    { path: '/api/loyalty/balance/:customerId', method: 'GET', handler: 'getBalance', authRequired: false },
  ],

  // ── UI ──
  ui: [
    { type: 'nav', label: 'Loyalty', path: '/dashboard/loyalty', icon: 'Award', group: 'Customers', order: 30 },
    { type: 'page', label: 'Customer Tiers', path: '/dashboard/loyalty/tiers', icon: 'Crown', group: 'Customers' },
    { type: 'page', label: 'Coupons', path: '/dashboard/loyalty/coupons', icon: 'Ticket', group: 'Customers' },
    { type: 'settings', label: 'Loyalty Configuration', path: '/dashboard/settings/loyalty', icon: 'Settings' },
  ],

  // ── Scheduled Jobs ──
  scheduledJobs: [
    { id: 'tier-review', name: 'Review Tier Upgrades', schedule: '0 2 * * *', handler: 'reviewTiers' },
    { id: 'coupon-expire', name: 'Expire Coupons', schedule: '0 1 * * *', handler: 'expireCoupons' },
  ],

  // ── Health Checks ──
  healthChecks: [
    { id: 'points-ledger', name: 'Points Ledger', handler: 'checkPointsLedger', timeoutMs: 2000 },
    { id: 'tier-engine', name: 'Tier Engine', handler: 'checkTierEngine', timeoutMs: 2000 },
  ],

  // ── Migrations ──
  migrations: [
    { version: '1.0.0', up: 'CREATE TABLE loyalty (...)', down: 'DROP TABLE loyalty' },
  ],

  // ── Dependencies ──
  dependencies: [],
  conflicts: [],
  provides: ['loyalty-rewards'],

  // ── Permissions ──
  permissions: [
    { scope: 'events', access: 'read', reason: 'Listen for payment.completed, sale.completed, delivery.delivered, customer.signup.' },
    { scope: 'events', access: 'write', reason: 'Emit loyalty.points_awarded, loyalty.tier_upgraded, loyalty.coupon_issued.' },
    { scope: 'tokens', access: 'write', reason: 'Mint and burn loyalty point tokens.' },
  ],

  // ── Compatibility ──
  compatibility: {
    minPaySwapVersion: '1.0.0',
    maxTestedPaySwapVersion: '1.2.0',
    breakingChanges: 'None — this is the initial release.',
    upgradeNotes: 'Run the v1.0.0 migration on install.',
    rollbackNotes: 'Drop the loyalty table on uninstall.',
  },

  // ── Billing ──
  billing: {
    model: 'SUBSCRIPTION',
    price: 29,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 14,
  },

  createdAt: Date.now(),
  updatedAt: Date.now(),
};
