/**
 * Built-in plugin: mtn-ghana-momo — MTN Ghana Mobile Money settlement rail.
 *
 * Demonstrates the canonical shape of a settlement-rail plugin:
 *   - Capability: settlement-rail "ghs-momo-rail"
 *   - Methods: quote({ amount, currency }), settle({ amount, currency, recipient }), status({ ref })
 *   - Commands: settle.payment
 *   - Events: listens to "payment.created" (scores + emits a rail.quote event)
 *   - Policy: max-tx-amount (rejects transactions above GHS 10,000)
 */

import type { PluginManifest, PluginModule, PluginContext } from '../types';

export const mtnGhanaMomoManifest: PluginManifest = {
  name: 'mtn-ghana-momo',
  version: '1.0.0',
  description: 'MTN Ghana Mobile Money settlement rail — quote, settle, and track MoMo transfers.',
  author: 'PaySwap',
  license: 'Apache-2.0',
  capabilities: [
    {
      type: 'settlement-rail',
      id: 'ghs-momo-rail',
      name: 'MTN Ghana MoMo Rail',
      config: { country: 'GH', currency: 'GHS', rail: 'mtn-momo', maxTxAmount: 10_000 },
    },
  ],
  permissions: ['payments:read', 'events:read', 'events:write', 'runtime:read'],
  commands: [
    { commandType: 'settle.payment', handler: 'settlePayment', description: 'Settle a payment via MTN MoMo' },
  ],
  events: [
    { eventType: 'payment.created', handler: 'onPaymentCreated', description: 'Score new payments + emit rail quotes' },
  ],
  views: [
    { id: 'momo-rail-status', name: 'MoMo Rail Status', placement: 'sidebar', route: '/admin/sdk' },
  ],
  policies: [
    { id: 'max-tx-amount', name: 'Max Transaction Amount', description: 'Reject transactions above GHS 10,000', enforce: 'enforceMaxTx' },
  ],
  dependencies: [],
  migrations: [
    { version: '1.0.0', description: 'Initial release', up: 'migrateUp100' },
  ],
  minRuntimeVersion: '1.0.0',
};

interface QuoteArgs {
  amount: number;
  currency: string;
}

interface SettleArgs {
  amount: number;
  currency: string;
  recipient: string;
  reference?: string;
}

interface StatusArgs {
  ref: string;
}

interface PolicyArgs {
  amount: number;
  currency: string;
}

/** In-memory store of reference → settlement record (per-process). */
const settlements = new Map<string, { ref: string; status: string; amount: number; currency: string; recipient: string; createdAt: number }>();

export const mtnGhanaMomoModule: PluginModule = {
  manifest: mtnGhanaMomoManifest,

  async onLoad(ctx: PluginContext) {
    ctx.logger.info('MTN Ghana MoMo plugin loaded', { version: mtnGhanaMomoManifest.version });
  },

  async onEnable(ctx: PluginContext) {
    ctx.logger.info('MTN Ghana MoMo plugin enabled');
    await ctx.store.set('enabledAt', Date.now());
  },

  async onDisable(ctx: PluginContext) {
    ctx.logger.info('MTN Ghana MoMo plugin disabled');
  },

  async onUnload(ctx: PluginContext) {
    ctx.logger.info('MTN Ghana MoMo plugin unloaded');
  },

  // ── Capability methods (invoked via ctx.call('ghs-momo-rail', '<method>', args)) ─

  /** Quote a fee + ETA for a GHS MoMo transfer. */
  quote(args: QuoteArgs) {
    const amount = Number(args?.amount ?? 0);
    const currency = (args?.currency ?? 'GHS').toString().toUpperCase();
    if (currency !== 'GHS') {
      return { ok: false, error: 'Only GHS supported by MTN MoMo rail' };
    }
    // Fee schedule: 1% with a GHS 0.50 floor and GHS 50 cap.
    const fee = Math.min(Math.max(amount * 0.01, 0.5), 50);
    return {
      ok: true,
      rail: 'mtn-momo',
      currency,
      amount,
      fee: Number(fee.toFixed(2)),
      etaSeconds: 30,
      total: Number((amount + fee).toFixed(2)),
    };
  },

  /** Settle a payment via MTN MoMo. Returns a reference + status. */
  async settle(args: SettleArgs, ctx?: PluginContext) {
    const amount = Number(args?.amount ?? 0);
    const currency = (args?.currency ?? 'GHS').toString().toUpperCase();
    const recipient = (args?.recipient ?? '').toString();
    if (!recipient) return { ok: false, error: 'recipient required' };
    if (currency !== 'GHS') return { ok: false, error: 'Only GHS supported' };

    const ref = `momo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      ref,
      status: 'PENDING',
      amount,
      currency,
      recipient,
      createdAt: Date.now(),
    };
    settlements.set(ref, record);

    // Simulate async settlement by transitioning to COMPLETED after a tick.
    setTimeout(() => {
      const r = settlements.get(ref);
      if (r) {
        r.status = 'COMPLETED';
        settlements.set(ref, r);
      }
    }, 50);

    if (ctx) {
      await ctx.emit({
        type: 'rail.settlement.initiated',
        payload: { ref, amount, currency, recipient, rail: 'mtn-momo' },
      });
    }
    return { ok: true, ref, status: 'PENDING', amount, currency, recipient };
  },

  /** Look up the status of a settlement by reference. */
  status(args: StatusArgs) {
    const ref = (args?.ref ?? '').toString();
    const record = settlements.get(ref);
    if (!record) return { ok: false, error: `Reference "${ref}" not found` };
    return { ok: true, ...record };
  },

  // ── Command handlers (invoked when a "settle.payment" command is dispatched) ─

  async settlePayment(args: { amount: number; currency: string; recipient: string; reference?: string }, ctx?: PluginContext) {
    return this.settle(args, ctx);
  },

  // ── Event handlers ──────────────────────────────────────────────────────

  async onPaymentCreated(event: { type: string; payload: Record<string, unknown> }, ctx?: PluginContext) {
    const amount = Number(event?.payload?.amount ?? 0);
    const currency = String(event?.payload?.currency ?? 'GHS').toUpperCase();
    if (currency !== 'GHS') return; // ignore non-GHS
    const quoteResult = this.quote({ amount, currency });
    if (ctx && quoteResult.ok) {
      await ctx.emit({
        type: 'rail.quote.generated',
        payload: { sourceEvent: event.type, ...quoteResult },
      });
    }
  },

  // ── Policy enforcement ─────────────────────────────────────────────────

  enforceMaxTx(args: PolicyArgs) {
    const amount = Number(args?.amount ?? 0);
    const currency = String(args?.currency ?? 'GHS').toUpperCase();
    if (currency === 'GHS' && amount > 10_000) {
      return { passed: false, reason: `GHS ${amount} exceeds the GHS 10,000 per-tx cap` };
    }
    return { passed: true };
  },

  // ── Migrations ──────────────────────────────────────────────────────────

  migrateUp100(_ctx?: PluginContext) {
    // No-op for v1.0.0 — fresh install.
    return { migrated: true, version: '1.0.0' };
  },
};
