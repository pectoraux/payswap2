/**
 * Kernel Manifest — the runtime's identity card. (M-RT-28.)
 *
 * Every runtime startup prints the manifest.
 * Every deployment stores the manifest.
 * Every health endpoint exposes the manifest.
 *
 * This is the equivalent of a database schema version, except for the
 * entire runtime.
 */

export interface KernelManifest {
  /** Runtime version. */
  version: string;
  /** When the manifest was generated (epoch ms). */
  generatedAt: number;
  /** Environment (sandbox | live). */
  environment: string;
  /** All capabilities registered in the runtime. */
  capabilities: ManifestCapability[];
  /** All registries. */
  registries: {
    eventTypes: number;
    upcasters: number;
    projections: number;
    invariants: number;
    commandHandlers: number;
    settlementAdapters: number;
  };
  /** Total events in the EventStore. */
  totalEvents: number;
  /** Total projections. */
  totalProjections: number;
}

export interface ManifestCapability {
  name: string;
  version: number;
  status: 'active' | 'inactive';
}

/**
 * Build the kernel manifest from the runtime.
 */
export function buildManifest(runtime: {
  schema: { getReport: () => { totalEventTypes: number; totalUpcasters: number; totalProjections: number } };
  invariants: { report: () => { total: number } };
  commands: { types: () => string[] };
  settlements: { networks: () => string[] };
  eventStore: { size: () => number };
  health: { allHealth: () => Promise<unknown[]> } | { names: () => string[] };
}): KernelManifest {
  const schemaReport = runtime.schema.getReport();

  const capabilities: ManifestCapability[] = [
    { name: 'payments', version: 1, status: 'active' },
    { name: 'refunds', version: 1, status: 'active' },
    { name: 'wallets', version: 1, status: 'active' },
    { name: 'treasury', version: 1, status: 'active' },
    { name: 'twin-tokens', version: 1, status: 'active' },
    { name: 'lp-runtime', version: 1, status: 'active' },
    { name: 'marketplace', version: 1, status: 'active' },
    { name: 'economic-compiler', version: 1, status: 'active' },
    { name: 'settlement', version: 1, status: 'active' },
    { name: 'schema-registry', version: 1, status: 'active' },
    { name: 'invariant-engine', version: 1, status: 'active' },
    { name: 'transaction-coordinator', version: 1, status: 'active' },
    { name: 'recovery-manager', version: 1, status: 'active' },
  ];

  return {
    version: '1.0.0-mrt28',
    generatedAt: Date.now(),
    environment: 'live',
    capabilities,
    registries: {
      eventTypes: schemaReport.totalEventTypes,
      upcasters: schemaReport.totalUpcasters,
      projections: schemaReport.totalProjections,
      invariants: runtime.invariants.report().total,
      commandHandlers: runtime.commands.types().length,
      settlementAdapters: runtime.settlements.networks().length,
    },
    totalEvents: runtime.eventStore.size(),
    totalProjections: schemaReport.totalProjections,
  };
}
