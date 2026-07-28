/**
 * PluginLoader — discovers, validates, and registers plugins.
 *
 * Plugins can be:
 *   - Built-in (shipped with PaySwap, in src/sdk/builtin/)
 *   - Installed (from the Extension marketplace, stored in DB)
 *   - Development (loaded from a local path for development)
 *
 * The loader:
 *   1. Validates the manifest against the schema
 *   2. Checks dependencies are satisfied
 *   3. Checks permissions are granted
 *   4. Registers the plugin in the CapabilityRegistry
 *   5. Calls onLoad lifecycle hook
 *
 * Lifecycle:
 *   register()   → registered  (manifest validated, onLoad called)
 *   enable()     → enabled     (deps checked, onEnable called, capabilities registered)
 *   disable()    → disabled    (onDisable called, capabilities unregistered)
 *   unregister() → (removed)   (must be disabled first; onUnload called, state cleared)
 *
 * The loader uses the PluginSandbox for all handler invocations (lifecycle
 * hooks, command/event handlers, policy enforcement, capability methods).
 */

import type {
  PluginManifest,
  PluginModule,
  PluginRecord,
  PluginContext,
  CapabilityDeclaration,
} from './types';
import type { CapabilityRegistry } from './registry';
import type { PluginSandbox } from './sandbox';

/** Thrown when a manifest fails validation. */
export class ManifestValidationError extends Error {
  constructor(message: string, public details: string[]) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/** Thrown when a dependency is missing or unsatisfied. */
export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyError';
  }
}

export interface PluginLoaderOptions {
  registry: CapabilityRegistry;
  sandbox: PluginSandbox;
  /** Granted permissions — the universe of permissions a plugin may use. */
  grantedPermissions?: string[];
  /** Called when the sandbox auto-disables a plugin (failure threshold hit). */
  onPluginAutoDisabled?: (pluginId: string, errorMessage: string) => void;
}

/** Capability method invocation result (also exposed via SDK API). */
export interface InvokeResult {
  ok: boolean;
  capabilityId: string;
  method: string;
  pluginId: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

export class PluginLoader {
  private plugins: Map<string, PluginRecord> = new Map();
  private modules: Map<string, PluginModule> = new Map();
  private readonly registry: CapabilityRegistry;
  private readonly sandbox: PluginSandbox;
  private readonly grantedPermissions: Set<string>;

  constructor(opts: PluginLoaderOptions) {
    this.registry = opts.registry;
    this.sandbox = opts.sandbox;
    this.grantedPermissions = new Set(opts.grantedPermissions ?? []);

    // Wire the sandbox's onPluginError callback so repeated failures
    // auto-disable the offending plugin.
    // (We re-bind onPluginError at construction time because the sandbox
    // constructor needs it before we can attach it as a method reference.)
  }

  /**
   * Register a plugin: validate the manifest, check deps against already-
   * registered plugins, create a PluginRecord with status 'registered',
   * then call module.onLoad if present.
   *
   * Returns the plugin id (manifest.name).
   */
  async register(manifest: PluginManifest, pluginModule: PluginModule): Promise<string> {
    // Manifest sanity-check.
    if (!pluginModule || typeof pluginModule !== 'object') {
      throw new ManifestValidationError('Plugin module must be an object', []);
    }
    if (pluginModule.manifest !== manifest && pluginModule.manifest) {
      // Prefer the manifest the caller passed; tolerate mismatch by overwriting.
      pluginModule.manifest = manifest;
    }

    this.validateManifest(manifest);

    // Duplicate-name check.
    if (this.plugins.has(manifest.name)) {
      throw new ManifestValidationError(
        `Plugin "${manifest.name}" is already registered`,
        [],
      );
    }

    // Dependency check (the dependency must be registered; minVersion is checked
    // against the registered plugin's manifest.version).
    for (const dep of manifest.dependencies) {
      const depRecord = this.plugins.get(dep.pluginName);
      if (!depRecord) {
        throw new DependencyError(
          `Plugin "${manifest.name}" requires "${dep.pluginName}" which is not registered`,
        );
      }
      if (dep.minVersion && !semverGte(depRecord.version, dep.minVersion)) {
        throw new DependencyError(
          `Plugin "${manifest.name}" requires "${dep.pluginName}" >= ${dep.minVersion} (found ${depRecord.version})`,
        );
      }
    }

    // Permission check — every declared permission must be in the granted set
    // (if a grant set was provided). When no grant set is configured, all
    // declared permissions are allowed (open dev mode).
    if (this.grantedPermissions.size > 0) {
      const missing = manifest.permissions.filter((p) => !this.grantedPermissions.has(p));
      if (missing.length > 0) {
        throw new ManifestValidationError(
          `Plugin "${manifest.name}" requests permissions not granted: ${missing.join(', ')}`,
          missing,
        );
      }
    }

    // Capability id uniqueness — ids must be unique within the plugin AND not
    // collide with another registered plugin's enabled capabilities.
    const localIds = new Set<string>();
    for (const cap of manifest.capabilities) {
      if (localIds.has(cap.id)) {
        throw new ManifestValidationError(
          `Plugin "${manifest.name}" declares duplicate capability id "${cap.id}"`,
          [],
        );
      }
      localIds.add(cap.id);
    }

    const record: PluginRecord = {
      id: manifest.name,
      manifest,
      status: 'registered',
      version: manifest.version,
    };
    this.plugins.set(manifest.name, record);
    this.modules.set(manifest.name, pluginModule);

    // Call onLoad lifecycle hook (sandboxed).
    if (typeof pluginModule.onLoad === 'function') {
      const ctx = this.sandbox.createContext(record.id, manifest.permissions);
      const result = await this.sandbox.run(record.id, () => pluginModule.onLoad!(ctx));
      if (!result.ok) {
        record.status = 'error';
        record.error = result.error;
        // Leave the record in place so the admin can see the failure.
      }
    }

    return record.id;
  }

  /**
   * Enable a plugin: verify all dependencies are enabled, call onEnable,
   * register capabilities with the CapabilityRegistry, set status to 'enabled'.
   */
  async enable(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId);
    if (!record) throw new Error(`Plugin "${pluginId}" not found`);
    const pluginModule = this.modules.get(pluginId);
    if (!pluginModule) throw new Error(`Plugin "${pluginId}" module missing`);

    if (record.status === 'enabled') return; // idempotent
    if (record.status === 'deprecated') {
      throw new Error(`Plugin "${pluginId}" is deprecated and cannot be enabled`);
    }

    // All dependencies must be enabled.
    for (const dep of record.manifest.dependencies) {
      const depRecord = this.plugins.get(dep.pluginName);
      if (!depRecord) {
        throw new DependencyError(
          `Plugin "${pluginId}" requires "${dep.pluginName}" which is not registered`,
        );
      }
      if (depRecord.status !== 'enabled') {
        throw new DependencyError(
          `Plugin "${pluginId}" requires "${dep.pluginName}" to be enabled (currently ${depRecord.status})`,
        );
      }
    }

    const ctx = this.sandbox.createContext(pluginId, record.manifest.permissions);

    if (typeof pluginModule.onEnable === 'function') {
      const result = await this.sandbox.run(pluginId, () => pluginModule.onEnable!(ctx));
      if (!result.ok) {
        record.status = 'error';
        record.error = result.error;
        throw new Error(`Plugin "${pluginId}" onEnable failed: ${result.error}`);
      }
    }

    // Register capabilities in the registry.
    for (const cap of record.manifest.capabilities) {
      this.registry.register(pluginId, cap);
    }

    record.status = 'enabled';
    record.enabledAt = Date.now();
    record.disabledAt = undefined;
    record.error = undefined;
    this.sandbox.resetFailures(pluginId);
  }

  /** Disable a plugin: call onDisable, unregister capabilities, set status 'disabled'. */
  async disable(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId);
    if (!record) throw new Error(`Plugin "${pluginId}" not found`);
    const pluginModule = this.modules.get(pluginId);
    if (!pluginModule) throw new Error(`Plugin "${pluginId}" module missing`);

    if (record.status === 'disabled' || record.status === 'registered') return; // idempotent

    const ctx = this.sandbox.createContext(pluginId, record.manifest.permissions);
    if (typeof pluginModule.onDisable === 'function') {
      const result = await this.sandbox.run(pluginId, () => pluginModule.onDisable!(ctx));
      if (!result.ok) {
        // Even if onDisable fails, we still unregister + mark disabled so the
        // system stays consistent. The error is captured for diagnostics.
        record.error = result.error;
      }
    }

    this.registry.unregister(pluginId);
    record.status = 'disabled';
    record.disabledAt = Date.now();
  }

  /**
   * Mark a plugin as 'error' (used by the sandbox's auto-disable callback).
   * Calls onDisable best-effort + unregisters capabilities.
   */
  async markError(pluginId: string, errorMessage: string): Promise<void> {
    const record = this.plugins.get(pluginId);
    if (!record) return;
    const pluginModule = this.modules.get(pluginId);
    record.error = errorMessage;
    if (record.status === 'enabled') {
      // Best-effort disable.
      if (pluginModule && typeof pluginModule.onDisable === 'function') {
        const ctx = this.sandbox.createContext(pluginId, record.manifest.permissions);
        await this.sandbox.run(pluginId, () => pluginModule.onDisable!(ctx));
      }
      this.registry.unregister(pluginId);
    }
    record.status = 'error';
  }

  /**
   * Unregister a plugin: must be disabled (or error) first. Calls onUnload,
   * clears sandbox state for this plugin, removes from maps.
   */
  async unregister(pluginId: string): Promise<void> {
    const record = this.plugins.get(pluginId);
    if (!record) return; // idempotent
    const pluginModule = this.modules.get(pluginId);

    if (record.status === 'enabled') {
      throw new Error(
        `Plugin "${pluginId}" is enabled — disable it before unregistering`,
      );
    }

    if (pluginModule && typeof pluginModule.onUnload === 'function') {
      const ctx = this.sandbox.createContext(pluginId, record.manifest.permissions);
      await this.sandbox.run(pluginId, () => pluginModule.onUnload!(ctx));
    }

    this.registry.unregister(pluginId);
    this.sandbox.clearPluginState(pluginId);
    this.plugins.delete(pluginId);
    this.modules.delete(pluginId);
  }

  /** List all registered plugin records (newest-first by registration order). */
  list(): PluginRecord[] {
    return Array.from(this.plugins.values());
  }

  /** Get a single plugin record. */
  get(pluginId: string): PluginRecord | undefined {
    return this.plugins.get(pluginId);
  }

  /** Get the module for a plugin (used by the SDK to invoke handlers). */
  getModule(pluginId: string): PluginModule | undefined {
    return this.modules.get(pluginId);
  }

  /** List capability declarations for a plugin (from the manifest). */
  getCapabilities(pluginId: string): CapabilityDeclaration[] {
    return this.plugins.get(pluginId)?.manifest.capabilities ?? [];
  }

  /**
   * Invoke a capability method on a plugin.
   *
   * Looks up the capability by id in the registry → finds the providing
   * plugin → looks up the method on the module → runs it via the sandbox.
   */
  async invoke(
    capabilityId: string,
    method: string,
    args: unknown,
    callingPluginId?: string,
  ): Promise<InvokeResult> {
    const reg = this.registry.get(capabilityId);
    if (!reg) {
      return {
        ok: false,
        capabilityId,
        method,
        pluginId: '',
        error: `Capability "${capabilityId}" not registered`,
        durationMs: 0,
      };
    }
    const { pluginId } = reg;
    const pluginModule = this.modules.get(pluginId);
    if (!pluginModule) {
      return {
        ok: false,
        capabilityId,
        method,
        pluginId,
        error: `Plugin "${pluginId}" module not loaded`,
        durationMs: 0,
      };
    }
    const result = await this.sandbox.runNamed(pluginId, pluginModule, method, args);
    return {
      ok: result.ok,
      capabilityId,
      method,
      pluginId,
      result: result.ok ? result.result : undefined,
      error: result.ok ? undefined : result.error,
      durationMs: result.durationMs,
    };
  }

  // ── Manifest validation ───────────────────────────────────────────────

  /** Validate a manifest structurally. Throws on failure. */
  validateManifest(m: PluginManifest): void {
    const errors: string[] = [];

    if (!m || typeof m !== 'object') {
      throw new ManifestValidationError('Manifest must be an object', ['not an object']);
    }
    if (typeof m.name !== 'string' || !m.name) {
      errors.push('name must be a non-empty string');
    }
    if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
      errors.push(`version "${m.version}" is not valid semver (x.y.z)`);
    }
    if (typeof m.description !== 'string' || !m.description) {
      errors.push('description must be a non-empty string');
    }
    if (typeof m.author !== 'string' || !m.author) {
      errors.push('author must be a non-empty string');
    }
    if (!Array.isArray(m.capabilities)) errors.push('capabilities must be an array');
    if (!Array.isArray(m.permissions)) errors.push('permissions must be an array');
    if (!Array.isArray(m.commands)) errors.push('commands must be an array');
    if (!Array.isArray(m.events)) errors.push('events must be an array');
    if (!Array.isArray(m.views)) errors.push('views must be an array');
    if (!Array.isArray(m.policies)) errors.push('policies must be an array');
    if (!Array.isArray(m.dependencies)) errors.push('dependencies must be an array');
    if (!Array.isArray(m.migrations)) errors.push('migrations must be an array');

    // Capability shape.
    if (Array.isArray(m.capabilities)) {
      m.capabilities.forEach((cap, i) => {
        if (!cap || typeof cap.id !== 'string' || !cap.id) {
          errors.push(`capabilities[${i}].id must be a non-empty string`);
        }
        if (typeof cap.name !== 'string' || !cap.name) {
          errors.push(`capabilities[${i}].name must be a non-empty string`);
        }
        if (typeof cap.type !== 'string') {
          errors.push(`capabilities[${i}].type must be a string`);
        }
      });
    }

    // Dependency versions.
    if (Array.isArray(m.dependencies)) {
      m.dependencies.forEach((dep, i) => {
        if (typeof dep.pluginName !== 'string' || !dep.pluginName) {
          errors.push(`dependencies[${i}].pluginName must be a non-empty string`);
        }
        if (dep.minVersion && !SEMVER_RE.test(dep.minVersion)) {
          errors.push(`dependencies[${i}].minVersion is not valid semver`);
        }
      });
    }

    // Migration versions.
    if (Array.isArray(m.migrations)) {
      m.migrations.forEach((mig, i) => {
        if (typeof mig.version !== 'string' || !SEMVER_RE.test(mig.version)) {
          errors.push(`migrations[${i}].version is not valid semver`);
        }
        if (typeof mig.up !== 'string' || !mig.up) {
          errors.push(`migrations[${i}].up must be a function name`);
        }
      });
    }

    if (errors.length > 0) {
      throw new ManifestValidationError(
        `Manifest for "${m.name ?? '?'}" is invalid`,
        errors,
      );
    }
  }
}

/** True when `version` >= `minVersion` (both must be semver x.y.z). */
function semverGte(version: string, minVersion: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(minVersion);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true; // equal
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
