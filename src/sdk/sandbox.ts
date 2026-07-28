/**
 * PluginSandbox — executes plugin code in a restricted context.
 *
 * Plugins do NOT have access to:
 *   - The filesystem (no fs, no path)
 *   - The network (no http, no fetch — unless they have the 'network' permission)
 *   - The process (no process, no require)
 *   - The database directly (no Prisma — they use ctx.store)
 *   - The runtime directly (no runtime import — they use ctx.runtime)
 *
 * Plugins communicate ONLY through the PluginContext.
 *
 * The sandbox:
 *   1. Manufactures a `PluginContext` for each plugin (with permissions enforced)
 *   2. Wraps every handler invocation in try/catch + a timeout
 *   3. Tracks per-plugin failure counts; if a plugin fails repeatedly, it is
 *      marked as 'error' via the `onPluginError` callback (the loader wires
 *      this to set the plugin's status to 'error' and call its onDisable)
 *   4. Owns the per-plugin KV store (used by ctx.store)
 *   5. Owns the SDK event log (used by ctx.emit)
 *
 * The sandbox does NOT hold plugin records or modules — that's the loader's
 * job. The sandbox holds per-plugin state that survives handler invocations
 * (the KV store + failure counts + event log).
 */

import type { PluginContext, Permission } from './types';
import type { SdkEventLogEntry } from './types';

/** Reads-only handle to the runtime the sandbox exposes to plugins. */
export interface SandboxRuntime {
  getBalanceSheet(): Promise<unknown>;
  getDigitalTwin(): Promise<unknown>;
  getEvents(filter?: { type?: string; limit?: number }): Promise<unknown[]>;
}

/** Hook the SDK wires up so ctx.emit reaches the rest of the system. */
export type EmitHook = (
  pluginId: string,
  event: { type: string; payload: Record<string, unknown> },
) => Promise<void>;

/** Hook the SDK wires up so ctx.call can invoke another plugin's capability. */
export type CallHook = (
  callingPluginId: string,
  capabilityId: string,
  method: string,
  args: unknown,
) => Promise<unknown>;

/** Loader-level callback for when a plugin has failed too many times. */
export type OnPluginError = (pluginId: string, errorMessage: string) => void;

export interface PluginSandboxOptions {
  runtime: SandboxRuntime;
  emitHook: EmitHook;
  callHook: CallHook;
  onPluginError?: OnPluginError;
  /** Default handler timeout (ms). Default: 5000. */
  defaultTimeoutMs?: number;
  /** Failures before a plugin is auto-marked 'error'. Default: 3. */
  failureThreshold?: number;
  /** Max event log entries retained. Default: 1000. */
  maxEventLog?: number;
}

/** Result of a sandboxed handler run. */
export type SandboxRunResult<T> =
  | { ok: true; result: T; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/** Default handler timeout (5s) — covers most plugin command handlers. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Default failure threshold — 3 crashes in a row → plugin auto-disabled. */
const DEFAULT_FAILURE_THRESHOLD = 3;

/** Max event log entries retained for diagnostics. */
const DEFAULT_MAX_EVENT_LOG = 1_000;

export class PluginSandbox {
  private readonly runtime: SandboxRuntime;
  private readonly emitHook: EmitHook;
  private readonly callHook: CallHook;
  private readonly onPluginError?: OnPluginError;
  private readonly defaultTimeoutMs: number;
  private readonly failureThreshold: number;
  private readonly maxEventLog: number;

  /** Per-plugin KV store (isolated). */
  private stores: Map<string, Map<string, unknown>> = new Map();
  /** Per-plugin failure count (reset on successful enable). */
  private failures: Map<string, number> = new Map();
  /** Bounded event log (most-recent first when read in reverse). */
  private eventLog: SdkEventLogEntry[] = [];
  /** Monotonic event id counter. */
  private eventSeq = 0;

  constructor(opts: PluginSandboxOptions) {
    this.runtime = opts.runtime;
    this.emitHook = opts.emitHook;
    this.callHook = opts.callHook;
    this.onPluginError = opts.onPluginError;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.maxEventLog = opts.maxEventLog ?? DEFAULT_MAX_EVENT_LOG;
  }

  /** Build a PluginContext bound to this plugin + its declared permissions. */
  createContext(pluginId: string, permissions: Permission[]): PluginContext {
    const has = (perm: Permission): boolean => permissions.includes(perm);

    const store = this.getOrCreateStore(pluginId);

    const ctx: PluginContext = {
      pluginId,
      logger: {
        info: (msg, meta) => this.log(pluginId, 'info', msg, meta),
        warn: (msg, meta) => this.log(pluginId, 'warn', msg, meta),
        error: (msg, meta) => this.log(pluginId, 'error', msg, meta),
      },
      runtime: {
        getBalanceSheet: async () => {
          if (!has('treasury:read') && !has('ledger:read')) {
            throw new PermissionDeniedError(pluginId, 'treasury:read|ledger:read');
          }
          return this.runtime.getBalanceSheet();
        },
        getDigitalTwin: async () => {
          if (!has('runtime:read')) {
            throw new PermissionDeniedError(pluginId, 'runtime:read');
          }
          return this.runtime.getDigitalTwin();
        },
        getEvents: async (filter) => {
          if (!has('events:read')) {
            throw new PermissionDeniedError(pluginId, 'events:read');
          }
          return this.runtime.getEvents(filter);
        },
      },
      emit: async (event) => {
        if (!has('events:write')) {
          throw new PermissionDeniedError(pluginId, 'events:write');
        }
        const entry: SdkEventLogEntry = {
          id: `evt_${++this.eventSeq}`,
          pluginId,
          type: event.type,
          payload: event.payload,
          emittedAt: Date.now(),
        };
        this.eventLog.push(entry);
        if (this.eventLog.length > this.maxEventLog) {
          this.eventLog.splice(0, this.eventLog.length - this.maxEventLog);
        }
        await this.emitHook(pluginId, event);
      },
      call: async (capabilityId, method, args) => {
        if (!has('runtime:read')) {
          throw new PermissionDeniedError(pluginId, 'runtime:read');
        }
        return this.callHook(pluginId, capabilityId, method, args);
      },
      store: {
        get: async (key) => store.get(key),
        set: async (key, value) => {
          store.set(key, value);
        },
        delete: async (key) => {
          store.delete(key);
        },
        list: async (prefix) => {
          const keys = Array.from(store.keys());
          return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
        },
      },
    };

    return ctx;
  }

  /**
   * Run a handler function with try/catch + timeout.
   *
   * On failure, increments the plugin's failure count; if it crosses the
   * threshold, fires `onPluginError` (the loader will mark the plugin as
   * 'error' and disable it).
   */
  async run<T>(
    pluginId: string,
    fn: () => T | Promise<T>,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<SandboxRunResult<T>> {
    const start = Date.now();
    try {
      const result = await this.withTimeout(Promise.resolve().then(fn), timeoutMs);
      return { ok: true, result, durationMs: Date.now() - start };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.recordFailure(pluginId, errorMessage);
      return { ok: false, error: errorMessage, durationMs: Date.now() - start };
    }
  }

  /**
   * Run a named handler method on a plugin module.
   *
   * Looks up `module[handlerName]`; if missing, returns an error result
   * (and records the failure).
   */
  async runNamed(
    pluginId: string,
    module: Record<string, any>,
    handlerName: string,
    args: unknown,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<SandboxRunResult<unknown>> {
    const fn = module?.[handlerName];
    if (typeof fn !== 'function') {
      const errorMessage = `Handler "${handlerName}" not found on plugin "${pluginId}"`;
      this.recordFailure(pluginId, errorMessage);
      return { ok: false, error: errorMessage, durationMs: 0 };
    }
    return this.run(pluginId, () => fn(args), timeoutMs);
  }

  /** Increment failure count; fire onPluginError when threshold crossed. */
  recordFailure(pluginId: string, errorMessage: string): void {
    const count = (this.failures.get(pluginId) ?? 0) + 1;
    this.failures.set(pluginId, count);
    if (count >= this.failureThreshold) {
      this.onPluginError?.(pluginId, errorMessage);
      // Reset so a future re-enable gets a fresh window.
      this.failures.set(pluginId, 0);
    }
  }

  /** Clear failures for a plugin (called when the plugin is enabled successfully). */
  resetFailures(pluginId: string): void {
    this.failures.delete(pluginId);
  }

  /** Current failure count for a plugin (for diagnostics). */
  getFailureCount(pluginId: string): number {
    return this.failures.get(pluginId) ?? 0;
  }

  /** Drop all per-plugin state (used on unregister). */
  clearPluginState(pluginId: string): void {
    this.stores.delete(pluginId);
    this.failures.delete(pluginId);
  }

  /** Read a snapshot of the plugin's KV store (for diagnostics / admin UI). */
  getStoreSnapshot(pluginId: string): Record<string, unknown> {
    const store = this.stores.get(pluginId);
    if (!store) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of store) out[k] = v;
    return out;
  }

  /** Read the SDK event log (newest first by default). */
  getEventLog(filter?: { pluginId?: string; type?: string; limit?: number }): SdkEventLogEntry[] {
    let entries = this.eventLog;
    if (filter?.pluginId) {
      entries = entries.filter((e) => e.pluginId === filter.pluginId);
    }
    if (filter?.type) {
      entries = entries.filter((e) => e.type === filter.type);
    }
    const limit = filter?.limit ?? 200;
    return entries.slice(-limit).reverse();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private getOrCreateStore(pluginId: string): Map<string, unknown> {
    let s = this.stores.get(pluginId);
    if (!s) {
      s = new Map();
      this.stores.set(pluginId, s);
    }
    return s;
  }

  private log(
    pluginId: string,
    level: 'info' | 'warn' | 'error',
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    // Lightweight structured log — surfaced in the admin UI via the SDK API.
    // (Server-side `console` is fine here — this is sandbox runtime code, not
    // a plugin. Next.js's log capture picks this up.)
    const line = `[sdk:${pluginId}] ${level.toUpperCase()} ${msg}`;
    if (level === 'error') {
      console.error(line, meta ?? '');
    } else if (level === 'warn') {
      console.warn(line, meta ?? '');
    } else {
      console.log(line, meta ?? '');
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (ms <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Plugin handler timed out after ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

/** Thrown when a plugin tries to use a permission it did not declare. */
export class PermissionDeniedError extends Error {
  constructor(pluginId: string, permission: string) {
    super(`Plugin "${pluginId}" lacks permission "${permission}"`);
    this.name = 'PermissionDeniedError';
  }
}
