/**
 * Built-in plugin: basic-fraud-detection — rule-based fraud scoring.
 *
 * Demonstrates a fraud-detection plugin:
 *   - Capability: fraud-detection "rule-based-fraud"
 *   - Methods: score({ amount, currency, customer }), review({ ref })
 *   - Events: listens to '*' (all events — observes the system)
 *   - Policy: velocity-check (rejects > 5 transactions per customer in 60s)
 */

import type { PluginManifest, PluginModule, PluginContext } from '../types';

export const basicFraudManifest: PluginManifest = {
  name: 'basic-fraud-detection',
  version: '0.9.0',
  description: 'Rule-based fraud scoring — amount thresholds, velocity, time-of-day heuristics.',
  author: 'PaySwap',
  license: 'Apache-2.0',
  capabilities: [
    {
      type: 'fraud-detection',
      id: 'rule-based-fraud',
      name: 'Rule-Based Fraud Scoring',
      config: { highRiskThreshold: 0.7, maxVelocityPerMinute: 5 },
    },
  ],
  permissions: ['payments:read', 'events:read', 'events:write', 'runtime:read'],
  commands: [
    { commandType: 'review.transaction', handler: 'reviewTransaction', description: 'Manually review a transaction' },
  ],
  events: [
    { eventType: '*', handler: 'onAnyEvent', description: 'Observe all events for fraud signals' },
  ],
  views: [
    { id: 'fraud-dashboard', name: 'Fraud Dashboard', placement: 'dashboard', route: '/admin/sdk' },
  ],
  policies: [
    {
      id: 'velocity-check',
      name: 'Velocity Check',
      description: 'Rejects customers with more than 5 transactions in 60 seconds',
      enforce: 'enforceVelocity',
    },
  ],
  dependencies: [],
  migrations: [
    { version: '0.9.0', description: 'Initial beta', up: 'migrateUp090' },
  ],
};

interface ScoreArgs {
  amount: number;
  currency: string;
  customer?: string;
  hour?: number;
}

interface ReviewArgs {
  ref: string;
  decision?: 'approve' | 'reject' | 'escalate';
}

interface VelocityArgs {
  customer: string;
  txCount: number;
  windowSeconds: number;
}

/** In-memory velocity counter (customer → list of recent timestamps). */
const velocityMap = new Map<string, number[]>();

/** In-memory review queue. */
const reviews = new Map<string, { ref: string; status: string; score: number; decidedAt?: number }>();

export const basicFraudModule: PluginModule = {
  manifest: basicFraudManifest,

  async onLoad(ctx: PluginContext) {
    ctx.logger.info('Basic fraud detection plugin loaded', { version: basicFraudManifest.version });
  },

  async onEnable(ctx: PluginContext) {
    ctx.logger.info('Basic fraud detection enabled');
    await ctx.store.set('enabledAt', Date.now());
    await ctx.store.set('totalScored', 0);
  },

  async onDisable(ctx: PluginContext) {
    ctx.logger.info('Basic fraud detection disabled');
  },

  async onUnload(ctx: PluginContext) {
    ctx.logger.info('Basic fraud detection unloaded');
  },

  // ── Capability methods ────────────────────────────────────────────────

  /**
   * Score a transaction. Returns a 0-1 risk score + a label.
   *
   * Heuristics:
   *   - amount > 5,000 in any currency → +0.3
   *   - hour between 02:00–05:00 local → +0.2
   *   - customer has > 3 txs in the last 60s → +0.4
   */
  async score(args: ScoreArgs, ctx?: PluginContext) {
    const amount = Number(args?.amount ?? 0);
    const currency = String(args?.currency ?? 'USD').toUpperCase();
    const customer = String(args?.customer ?? 'anon');
    const hour = Number(args?.hour ?? new Date().getHours());

    let score = 0;
    const reasons: string[] = [];

    if (amount > 5_000) {
      score += 0.3;
      reasons.push(`high amount (${amount} ${currency})`);
    }
    if (hour >= 2 && hour < 5) {
      score += 0.2;
      reasons.push('off-hours (02:00–05:00)');
    }
    const recent = this.recentCount(customer, 60);
    if (recent > 3) {
      score += 0.4;
      reasons.push(`velocity ${recent}/60s`);
    }
    score = Math.min(score, 1);

    // Record the timestamp for velocity tracking.
    const now = Date.now();
    const list = velocityMap.get(customer) ?? [];
    list.push(now);
    velocityMap.set(customer, list.filter((t) => now - t < 60_000));

    const label = score >= 0.7 ? 'HIGH' : score >= 0.4 ? 'MEDIUM' : 'LOW';

    if (ctx) {
      const total = Number(await ctx.store.get('totalScored') ?? 0) + 1;
      await ctx.store.set('totalScored', total);
      await ctx.emit({
        type: 'fraud.score.computed',
        payload: { customer, amount, currency, score, label, reasons },
      });
    }

    return { ok: true, score: Number(score.toFixed(2)), label, reasons, customer };
  },

  /** Look up or decide a manual review. */
  async review(args: ReviewArgs, ctx?: PluginContext) {
    const ref = String(args?.ref ?? '');
    const decision = args?.decision;
    let entry = reviews.get(ref);
    if (!entry) {
      entry = { ref, status: 'PENDING', score: 0 };
      reviews.set(ref, entry);
    }
    if (decision) {
      entry.status = decision.toUpperCase();
      entry.decidedAt = Date.now();
      reviews.set(ref, entry);
      if (ctx) {
        await ctx.emit({
          type: 'fraud.review.decided',
          payload: { ref, decision: entry.status },
        });
      }
    }
    return { ok: true, ...entry };
  },

  // ── Command handlers ──────────────────────────────────────────────────

  async reviewTransaction(args: ReviewArgs, ctx?: PluginContext) {
    return this.review(args, ctx);
  },

  // ── Event handlers ────────────────────────────────────────────────────

  async onAnyEvent(event: { type: string; payload: Record<string, unknown> }, ctx?: PluginContext) {
    // Only score payment-like events with an amount + currency.
    if (!event?.type?.startsWith('payment.')) return;
    const amount = Number(event?.payload?.amount ?? 0);
    const currency = String(event?.payload?.currency ?? 'USD');
    const customer = String(event?.payload?.customer ?? event?.payload?.customerId ?? 'anon');
    if (!amount) return;
    await this.score({ amount, currency, customer }, ctx);
  },

  // ── Policy enforcement ────────────────────────────────────────────────

  enforceVelocity(args: VelocityArgs) {
    const customer = String(args?.customer ?? 'anon');
    const txCount = Number(args?.txCount ?? 0);
    const windowSeconds = Number(args?.windowSeconds ?? 60);
    const max = Number(basicFraudManifest.capabilities[0].config?.maxVelocityPerMinute ?? 5);
    if (windowSeconds <= 60 && txCount > max) {
      return {
        passed: false,
        reason: `Customer "${customer}" exceeded velocity cap: ${txCount} txs in ${windowSeconds}s (max ${max}/60s)`,
      };
    }
    return { passed: true };
  },

  // ── Migrations ────────────────────────────────────────────────────────

  migrateUp090() {
    return { migrated: true, version: '0.9.0' };
  },

  // ── Helpers ───────────────────────────────────────────────────────────

  recentCount(customer: string, windowSeconds: number): number {
    const now = Date.now();
    const list = velocityMap.get(customer) ?? [];
    return list.filter((t) => now - t < windowSeconds * 1_000).length;
  },
};
