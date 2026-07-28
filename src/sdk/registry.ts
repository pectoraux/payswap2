/**
 * CapabilityRegistry — tracks what capabilities are available and which plugin provides them.
 *
 * When a plugin is enabled, its capabilities are registered here. Other parts
 * of the system (and other plugins) can look up capabilities by type or id.
 *
 * The registry is a pure in-memory index. It does NOT execute plugin code
 * — it just maps capabilityId → { pluginId, capability }. The PluginLoader
 * is responsible for registering/unregistering capabilities as plugins are
 * enabled/disabled.
 *
 * Lifecycle:
 *   - plugin enabled  → loader calls registry.register(pluginId, capability) for each capability
 *   - plugin disabled → loader calls registry.unregister(pluginId) for all of that plugin's capabilities
 *
 * Lookups:
 *   - get(id)              → single capability by its id
 *   - getByType(type)      → all capabilities of a given type
 *   - list()               → all registered capabilities
 */

import type { CapabilityDeclaration, CapabilityType } from './types';

export interface RegisteredCapability {
  pluginId: string;
  capability: CapabilityDeclaration;
}

export class CapabilityRegistry {
  /** capabilityId → RegisteredCapability */
  private capabilities: Map<string, RegisteredCapability> = new Map();

  /**
   * Register a capability for a plugin.
   *
   * If a capability with the same id was previously registered (e.g. an old
   * plugin is being replaced), it is overwritten — last writer wins.
   */
  register(pluginId: string, capability: CapabilityDeclaration): void {
    this.capabilities.set(capability.id, { pluginId, capability });
  }

  /** Unregister every capability belonging to a plugin (used on disable). */
  unregister(pluginId: string): void {
    for (const [id, reg] of this.capabilities) {
      if (reg.pluginId === pluginId) {
        this.capabilities.delete(id);
      }
    }
  }

  /** Look up a single capability by id. */
  get(capabilityId: string): RegisteredCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  /** All capabilities of a given type. */
  getByType(type: CapabilityType): RegisteredCapability[] {
    const out: RegisteredCapability[] = [];
    for (const reg of this.capabilities.values()) {
      if (reg.capability.type === type) out.push(reg);
    }
    return out;
  }

  /** All registered capabilities. */
  list(): RegisteredCapability[] {
    return Array.from(this.capabilities.values());
  }

  /** Number of registered capabilities. */
  size(): number {
    return this.capabilities.size;
  }

  /** True when a capability with this id is currently registered. */
  has(capabilityId: string): boolean {
    return this.capabilities.has(capabilityId);
  }
}
