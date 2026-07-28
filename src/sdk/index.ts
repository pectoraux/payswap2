/**
 * Capability SDK — public entry point.
 *
 * Wires together the CapabilityRegistry, PluginSandbox, and PluginLoader
 * into a single SDK instance. The SDK is a NEW layer that extends the
 * frozen runtime kernel (`src/runtime/`) WITHOUT modifying it. Plugins
 * communicate with the runtime ONLY through the PluginContext surface
 * manufactured by the sandbox.
 *
 * The SDK is a process-wide singleton (mirrors the runtime pattern): stored
 * on `globalThis.__PAYSWAP_SDK__` so Next.js dev-mode module re-instantiation
 * doesn't lose registered plugins.
 *
 * M-PLATFORM-39 Phase 1 ships:
 *   - Manifest schema (`types.ts`)
 *   - PluginLoader (`loader.ts`)
 *   - CapabilityRegistry (`registry.ts`)
 *   - PluginSandbox (`sandbox.ts`)
 *   - Built-in plugins (`builtin/`)
 *   - REST API (`/api/sdk/*`)
 *   - Admin UI (`/admin/sdk`)
 */

import { runtime } from '@/runtime';
import type { StoredEvent } from '@/runtime';
import { CapabilityRegistry } from './registry';
import { PluginSandbox, type SandboxRuntime } from './sandbox';
import {
  PluginLoader,
  type InvokeResult,
  type PluginLoaderOptions,
} from './loader';
import type {
  PluginManifest,
  PluginModule,
  PluginRecord,
  PluginContext,
  CapabilityDeclaration,
  CapabilityType,
  SdkEventLogEntry,
} from './types';
import { BUILTIN_PLUGINS } from './builtin';

export * from './types';
export * from './registry';
export * from './sandbox';
export * from './loader';

/** The SDK aggregates the loader + registry + sandbox into one handle. */
export interface PayscaleSdk {
  loader: PluginLoader;
  registry: CapabilityRegistry;
  sandbox: PluginSandbox;
  /** Convenience: register a plugin (delegates to loader.register). */
  register(manifest: PluginManifest, module: PluginModule): Promise<string>;
  /** Convenience: enable a plugin. */
  enable(pluginId: string): Promise<void>;
  /** Convenience: disable a plugin. */
  disable(pluginId: string): Promise<void>;
  /** Convenience: unregister a plugin. */
  unregister(pluginId: string): Promise<void>;
  /** Convenience: list all plugin records. */
  list(): PluginRecord[];
  /** Convenience: invoke a capability method. */
  invoke(capabilityId: string, method: string, args: unknown): Promise<InvokeResult>;
  /** Convenience: list registered capabilities (optionally filtered by type). */
  capabilities(type?: CapabilityType): { pluginId: string; capability: CapabilityDeclaration }[];
  /** Convenience: read the SDK event log (for admin UI). */
  events(filter?: { pluginId?: string; type?: string; limit?: number }): SdkEventLogEntry[];
  /** Convenience: read a plugin's KV-store snapshot. */
  storeSnapshot(pluginId: string): Record<string, unknown>;
  /** Convenience: get a single plugin record. */
  get(pluginId: string): PluginRecord | undefined;
}

export interface CreateSdkOptions {
  /** Granted permissions universe (default: all known permissions). */
  grantedPermissions?: string[];
  /** Whether to auto-register built-in plugins (default: true). */
  autoRegisterBuiltin?: boolean;
}

/** Build a fresh SDK instance (does not register built-ins automatically). */
export function createSdk(opts: CreateSdkOptions = {}): PayscaleSdk {
  const registry = new CapabilityRegistry();

  // SandboxRuntime — a thin adapter over the runtime singleton.
  // Reads-only. Never writes back to the runtime.
  const sandboxRuntime: SandboxRuntime = {
    async getBalanceSheet() {
      try {
        // The runtime's EconomicLedgerEngine exposes a synchronous balance sheet.
        return runtime.ledger.getBalanceSheet();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    async getDigitalTwin() {
      try {
        // Twin Tokens projection is the live digital-twin state derived from events.
        return runtime.twinTokens.view();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    async getEvents(filter) {
      try {
        const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);
        const all = await runtime.eventStore.readAll(0, limit);
        let filtered: StoredEvent[] = all;
        if (filter?.type) {
          filtered = all.filter((e) => e.type === filter.type);
        }
        return filtered.slice(-limit).map((e) => ({
          id: e.id,
          type: e.type,
          streamId: e.streamId,
          payload: e.payload,
          timestamp: e.metadata.timestamp,
          actor: e.metadata.actor,
        }));
      } catch (err) {
        return [{ error: err instanceof Error ? err.message : String(err) }];
      }
    },
  };

  // We need the loader reference inside the sandbox hooks, but the loader
  // needs the sandbox. Resolve with a `let` that's assigned after both exist.
  let loaderRef: PluginLoader | undefined;

  const sandbox = new PluginSandbox({
    runtime: sandboxRuntime,
    emitHook: async (_pluginId, _event) => {
      // The SDK keeps its own event log (in the sandbox). Plugins that want
      // their events to reach the runtime can do so via a runtime-aware
      // built-in (M-PLATFORM-39 Phase 2). For now, this is a no-op sink.
    },
    callHook: async (callingPluginId, capabilityId, method, args) => {
      if (!loaderRef) throw new Error('SDK not yet initialized');
      const result = await loaderRef.invoke(capabilityId, method, args, callingPluginId);
      if (!result.ok) {
        throw new Error(result.error ?? `Invocation of ${capabilityId}.${method} failed`);
      }
      return result.result;
    },
    onPluginError: (pluginId, errorMessage) => {
      // Auto-disable on repeated failures. Fire-and-forget — the loader's
      // markError is async but we don't need to await it here.
      if (loaderRef) {
        void loaderRef.markError(pluginId, errorMessage).catch(() => {
          // swallow — best-effort
        });
      }
    },
  });

  const loaderOpts: PluginLoaderOptions = {
    registry,
    sandbox,
    grantedPermissions: opts.grantedPermissions,
  };
  const loader = new PluginLoader(loaderOpts);
  loaderRef = loader;

  const sdk: PayscaleSdk = {
    loader,
    registry,
    sandbox,
    register: (m, mod) => loader.register(m, mod),
    enable: (id) => loader.enable(id),
    disable: (id) => loader.disable(id),
    unregister: (id) => loader.unregister(id),
    list: () => loader.list(),
    invoke: (capId, method, args) => loader.invoke(capId, method, args),
    capabilities: (type) =>
      type ? registry.getByType(type) : registry.list(),
    events: (filter) => sandbox.getEventLog(filter),
    storeSnapshot: (id) => sandbox.getStoreSnapshot(id),
    get: (id) => loader.get(id),
  };

  // Auto-register built-in plugins (idempotent — re-runs safely on hot reload).
  if (opts.autoRegisterBuiltin !== false) {
    void registerBuiltins(sdk).catch((err) => {
      // Don't crash on built-in registration failure — log and continue.
      console.error('[sdk] built-in plugin registration failed:', err);
    });
  }

  return sdk;
}

/**
 * Register all built-in plugins. Idempotent — skips already-registered.
 *
 * The registrations are launched CONCURRENTLY via Promise.all so that the
 * synchronous part of register() (validate + add to map) runs for every
 * built-in before any onLoad lifecycle hook awaits. This means
 * `sdk.list()` returns all built-ins immediately after `createSdk()`
 * returns, even though the lifecycle hooks (onLoad, onEnable) may still
 * be running in the background.
 */
export async function registerBuiltins(sdk: PayscaleSdk): Promise<void> {
  await Promise.all(
    BUILTIN_PLUGINS.map(async ({ manifest, module }) => {
      if (sdk.get(manifest.name)) return;
      try {
        const id = await sdk.register(manifest, module);
        // Built-ins are auto-enabled on first registration so the admin UI
        // has something to show without manual action.
        await sdk.enable(id);
      } catch (err) {
        console.error(`[sdk] failed to register built-in "${manifest.name}":`, err);
      }
    }),
  );
}

// ── Process-wide singleton ──────────────────────────────────────────────

const globalForSdk = globalThis as unknown as { __PAYSWAP_SDK__?: PayscaleSdk };

/** The default SDK singleton (auto-registers built-in plugins). */
export const sdk: PayscaleSdk =
  globalForSdk.__PAYSWAP_SDK__ ?? createSdk();

if (!globalForSdk.__PAYSWAP_SDK__) {
  globalForSdk.__PAYSWAP_SDK__ = sdk;
}
