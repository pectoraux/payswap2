/**
 * Built-in plugin: treasury-analytics — analytics view over treasury state.
 *
 * Demonstrates an analytics plugin that reads runtime state via ctx.runtime:
 *   - Capability: analytics "treasury-analytics"
 *   - Methods: getMetrics(), getReserveBreakdown()
 *   - Views: treasury-dashboard (placement: dashboard)
 *
 * No commands, no events, no policies — this is a pure read-side plugin.
 */

import type { PluginManifest, PluginModule, PluginContext } from '../types';

export const treasuryAnalyticsManifest: PluginManifest = {
  name: 'treasury-analytics',
  version: '1.2.0',
  description: 'Treasury analytics — exposes balance-sheet metrics for dashboards.',
  author: 'PaySwap',
  license: 'Apache-2.0',
  capabilities: [
    {
      type: 'analytics',
      id: 'treasury-analytics',
      name: 'Treasury Analytics',
      config: { refreshIntervalMs: 30_000 },
    },
  ],
  permissions: ['treasury:read', 'runtime:read'],
  commands: [],
  events: [],
  views: [
    { id: 'treasury-dashboard', name: 'Treasury Dashboard', placement: 'dashboard', route: '/admin/sdk' },
    { id: 'treasury-breakdown', name: 'Reserve Breakdown', placement: 'standalone', route: '/admin/sdk' },
  ],
  policies: [],
  dependencies: [],
  migrations: [
    { version: '1.0.0', description: 'Initial release', up: 'migrateUp100' },
    { version: '1.2.0', description: 'Added reserve breakdown endpoint', up: 'migrateUp120' },
  ],
};

export const treasuryAnalyticsModule: PluginModule = {
  manifest: treasuryAnalyticsManifest,

  async onLoad(ctx: PluginContext) {
    ctx.logger.info('Treasury analytics plugin loaded', { version: treasuryAnalyticsManifest.version });
  },

  async onEnable(ctx: PluginContext) {
    ctx.logger.info('Treasury analytics enabled');
    await ctx.store.set('enabledAt', Date.now());
    await ctx.store.set('metricsCalls', 0);
  },

  async onDisable(ctx: PluginContext) {
    ctx.logger.info('Treasury analytics disabled');
  },

  async onUnload(ctx: PluginContext) {
    ctx.logger.info('Treasury analytics unloaded');
  },

  // ── Capability methods ────────────────────────────────────────────────

  /** Return a high-level metrics snapshot derived from the runtime balance sheet. */
  async getMetrics(_args: unknown, ctx?: PluginContext) {
    if (!ctx) return { ok: false, error: 'No context' };
    const sheet = (await ctx.runtime.getBalanceSheet()) as Record<string, unknown> | null;
    const twin = (await ctx.runtime.getDigitalTwin()) as Record<string, unknown> | null;

    const calls = Number(await ctx.store.get('metricsCalls') ?? 0) + 1;
    await ctx.store.set('metricsCalls', calls);

    return {
      ok: true,
      generatedAt: Date.now(),
      calls,
      balanceSheetKeys: sheet ? Object.keys(sheet) : [],
      twinKeys: twin ? Object.keys(twin) : [],
      hasBalanceSheet: !!sheet,
      hasTwin: !!twin,
    };
  },

  /** Return a structured reserve breakdown (stub — derived from balance sheet if available). */
  async getReserveBreakdown(_args: unknown, ctx?: PluginContext) {
    if (!ctx) return { ok: false, error: 'No context' };
    const sheet = (await ctx.runtime.getBalanceSheet()) as any;
    const accounts = Array.isArray(sheet?.accounts) ? sheet.accounts : [];
    const reserves = accounts.filter((a: any) => a?.kind === 'reserve' || a?.type === 'reserve');
    return {
      ok: true,
      count: reserves.length,
      total: reserves.reduce((s: number, a: any) => s + Number(a?.availableBalance ?? a?.balance ?? 0), 0),
      items: reserves.slice(0, 50).map((a: any) => ({
        id: a?.id ?? a?.reference ?? '?',
        currency: a?.currency ?? '?',
        balance: Number(a?.availableBalance ?? a?.balance ?? 0),
      })),
    };
  },

  // ── Migrations ────────────────────────────────────────────────────────

  migrateUp100() {
    return { migrated: true, version: '1.0.0' };
  },
  migrateUp120() {
    return { migrated: true, version: '1.2.0' };
  },
};
