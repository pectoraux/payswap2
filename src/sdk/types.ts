/**
 * Plugin Manifest — the declaration every PaySwap plugin provides.
 *
 * A plugin extends the PaySwap runtime with new capabilities without
 * modifying the frozen kernel. Plugins declare:
 *   - Capabilities (what they provide: settlement rails, wallets, compliance, etc.)
 *   - Permissions (what they need access to)
 *   - Commands (what actions they handle)
 *   - Events (what they emit or listen to)
 *   - Views (what UI they contribute)
 *   - Policies (what rules they enforce)
 *   - Dependencies (what other plugins they need)
 *   - Migrations (how to upgrade their data)
 *
 * The Capability SDK is a NEW layer that extends the runtime. The kernel
 * (`src/runtime/`) is frozen and never imported by plugins directly —
 * plugins communicate ONLY through the PluginContext.
 */

export type CapabilityType =
  | 'settlement-rail'
  | 'wallet'
  | 'compliance'
  | 'identity'
  | 'analytics'
  | 'fraud-detection'
  | 'corridor-optimizer'
  | 'pricing-engine'
  | 'country'
  | 'stablecoin'
  | 'twin-token'
  | 'marketplace-algorithm'
  | 'ai-director'
  | 'notification'
  | 'custom';

export interface CapabilityDeclaration {
  type: CapabilityType;
  /** Unique within this plugin, e.g. "ghs-momo-rail" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Static config */
  config?: Record<string, unknown>;
}

export type Permission =
  | 'payments:read' | 'payments:write'
  | 'payouts:read' | 'payouts:write'
  | 'wallets:read' | 'wallets:write'
  | 'customers:read' | 'customers:write'
  | 'ledger:read' | 'ledger:write'
  | 'treasury:read' | 'treasury:write'
  | 'marketplace:read' | 'marketplace:write'
  | 'compliance:read' | 'compliance:write'
  | 'runtime:read' | 'runtime:write'
  | 'events:read' | 'events:write';

export interface CommandHandler {
  /** e.g. "settle.payment" */
  commandType: string;
  /** Function name in the plugin module */
  handler: string;
  description?: string;
}

export interface EventHandler {
  /** Event type to listen to, or '*' for all */
  eventType: string | '*';
  /** Function name in the plugin module */
  handler: string;
  description?: string;
}

export interface ViewDeclaration {
  /** e.g. "fraud-dashboard" */
  id: string;
  name: string;
  /** Route to navigate to */
  route?: string;
  /** Component name to render */
  component?: string;
  placement?: 'sidebar' | 'dashboard' | 'settings' | 'standalone';
}

export interface PolicyDeclaration {
  id: string;
  name: string;
  description: string;
  /** Function name that returns { passed: boolean, reason?: string } */
  enforce: string;
}

export interface Dependency {
  pluginName: string;
  minVersion?: string;
}

export interface Migration {
  version: string;
  description: string;
  /** Function name */
  up: string;
  /** Function name for rollback */
  down?: string;
}

export interface PluginManifest {
  /** Unique plugin name, e.g. "mtn-ghana-momo" */
  name: string;
  /** semver */
  version: string;
  description: string;
  author: string;
  license?: string;

  capabilities: CapabilityDeclaration[];
  permissions: Permission[];
  commands: CommandHandler[];
  events: EventHandler[];
  views: ViewDeclaration[];
  policies: PolicyDeclaration[];
  dependencies: Dependency[];
  migrations: Migration[];

  /** Runtime constraints */
  minRuntimeVersion?: string;
  maxRuntimeVersion?: string;
}

/**
 * Plugin module interface — what the plugin code exports.
 *
 * Handler functions (commands, events, policies, migrations) are looked up
 * by name via the `[key: string]: any` index signature.
 */
export interface PluginModule {
  manifest: PluginManifest;
  /** Lifecycle hooks */
  onLoad?(ctx: PluginContext): Promise<void> | void;
  onEnable?(ctx: PluginContext): Promise<void> | void;
  onDisable?(ctx: PluginContext): Promise<void> | void;
  onUnload?(ctx: PluginContext): Promise<void> | void;
  /** Command/event/policy/view handlers are looked up by name */
  [key: string]: any;
}

/**
 * Context given to plugins — this is the ONLY way plugins interact with the runtime.
 *
 * All access respects the plugin's declared permissions (a plugin without
 * `payments:read` cannot read payments via ctx.runtime).
 */
export interface PluginContext {
  pluginId: string;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Read-only access to runtime state (respects permissions) */
  runtime: {
    getBalanceSheet(): Promise<unknown>;
    getDigitalTwin(): Promise<unknown>;
    getEvents(filter?: { type?: string; limit?: number }): Promise<unknown[]>;
  };
  /** Emit events (respects permissions) */
  emit(event: { type: string; payload: Record<string, unknown> }): Promise<void>;
  /** Call other plugins' capabilities (respects permissions) */
  call(capabilityId: string, method: string, args: unknown): Promise<unknown>;
  /** Store plugin-specific data (isolated per plugin) */
  store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };
}

/** Plugin lifecycle states. */
export type PluginStatus =
  | 'registered'   // manifest loaded, not yet enabled
  | 'enabled'      // active and handling commands/events
  | 'disabled'     // loaded but not active
  | 'error'        // failed to load or crashed
  | 'deprecated';  // marked for removal

export interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  status: PluginStatus;
  enabledAt?: number;
  disabledAt?: number;
  error?: string;
  version: string;
}

/** Result of invoking a capability method. */
export interface InvocationResult {
  ok: boolean;
  capabilityId: string;
  method: string;
  result?: unknown;
  error?: string;
  pluginId: string;
  durationMs: number;
}

/** Event log entry stored by the sandbox for diagnostics. */
export interface SdkEventLogEntry {
  id: string;
  pluginId: string;
  type: string;
  payload: Record<string, unknown>;
  emittedAt: number;
}
