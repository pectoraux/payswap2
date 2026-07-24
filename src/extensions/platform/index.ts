/**
 * PaySwap Extension Platform — Manifest, Lifecycle, SDK.
 *
 * Extensions NEVER manipulate balances directly. They submit Intents; the
 * kernel converges. Extensions register Capabilities + Rules + Commands +
 * Policies. The kernel changes zero lines.
 *
 * Lifecycle: Submitted → Reviewed → Approved → Installed → Enabled → Running
 *             → Disabled → Suspended → Removed
 */
import { uid } from '@/kernel/support';
import type { Capability } from '@/kernel/capabilities';

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  capabilities: CapabilityDeclaration[];
  commands: CommandDeclaration[];
  entities: EntityDeclaration[];
  policies: PolicyDeclaration[];
  events: EventSubscription[];
  contracts: ContractDeclaration[];
  stateMachines: StateMachineDeclaration[];
  permissions: string[];
  limits: { maxEntities: number; maxCommandsPerSecond: number; maxStorageBytes: number };
}

export interface CapabilityDeclaration {
  name: string;
  label: string;
  description: string;
}

export interface CommandDeclaration {
  type: string;
  label: string;
  description: string;
}

export interface EntityDeclaration {
  type: string;
  label: string;
  capabilities: Capability[];
}

export interface PolicyDeclaration {
  name: string;
  description: string;
  defaultValue: unknown;
}

export interface EventSubscription {
  eventType: string;
  handler: string;
}

export interface ContractDeclaration {
  type: string;
  commands: string[];
}

export interface StateMachineDeclaration {
  kind: string;
  initial: string;
  edges: { from: string; to: string; trigger: string }[];
}

export type ExtensionState =
  | 'submitted'
  | 'reviewed'
  | 'approved'
  | 'installed'
  | 'enabled'
  | 'running'
  | 'disabled'
  | 'suspended'
  | 'removed';

export interface ExtensionRecord {
  id: string;
  manifest: ExtensionManifest;
  state: ExtensionState;
  installedAt: number;
  enabledAt: number | null;
  entityCount: number;
  commandCount: number;
}

class ExtensionPlatform {
  private extensions: Map<string, ExtensionRecord> = new Map();
  private enabledHandlers: Map<string, Map<string, (event: { type: string; payload: Record<string, unknown> }) => void>> = new Map();

  /** Submit an extension for review. */
  submit(manifest: ExtensionManifest): ExtensionRecord {
    const record: ExtensionRecord = {
      id: manifest.id,
      manifest,
      state: 'submitted',
      installedAt: 0,
      enabledAt: null,
      entityCount: 0,
      commandCount: 0,
    };
    this.extensions.set(manifest.id, record);
    return record;
  }

  /** Review → approve. */
  approve(extensionId: string): ExtensionRecord | undefined {
    const ext = this.extensions.get(extensionId);
    if (ext && ext.state === 'submitted') {
      ext.state = 'approved';
    }
    return ext;
  }

  /** Install an approved extension. */
  install(extensionId: string): ExtensionRecord | undefined {
    const ext = this.extensions.get(extensionId);
    if (ext && ext.state === 'approved') {
      ext.state = 'installed';
      ext.installedAt = Date.now();
    }
    return ext;
  }

  /** Enable an installed extension. */
  enable(extensionId: string): ExtensionRecord | undefined {
    const ext = this.extensions.get(extensionId);
    if (ext && (ext.state === 'installed' || ext.state === 'disabled')) {
      ext.state = 'enabled';
      ext.enabledAt = Date.now();
      this.enabledHandlers.set(extensionId, new Map());
    }
    return ext;
  }

  /** Disable a running extension. */
  disable(extensionId: string): ExtensionRecord | undefined {
    const ext = this.extensions.get(extensionId);
    if (ext && (ext.state === 'enabled' || ext.state === 'suspended')) {
      ext.state = 'disabled';
      this.enabledHandlers.delete(extensionId);
    }
    return ext;
  }

  /** Suspend an extension (policy violation). */
  suspend(extensionId: string): ExtensionRecord | undefined {
    const ext = this.extensions.get(extensionId);
    if (ext && ext.state === 'enabled') {
      ext.state = 'suspended';
    }
    return ext;
  }

  /** Remove an extension. */
  remove(extensionId: string): boolean {
    const ext = this.extensions.get(extensionId);
    if (ext && ext.state !== 'running') {
      ext.state = 'removed';
      this.enabledHandlers.delete(extensionId);
      return true;
    }
    return false;
  }

  /** Get an extension. */
  get(extensionId: string): ExtensionRecord | undefined {
    return this.extensions.get(extensionId);
  }

  /** List all extensions. */
  list(): ExtensionRecord[] {
    return [...this.extensions.values()];
  }

  /** List enabled extensions. */
  enabled(): ExtensionRecord[] {
    return this.list().filter((e) => e.state === 'enabled');
  }

  /** Check if an extension is enabled. */
  isEnabled(extensionId: string): boolean {
    return this.extensions.get(extensionId)?.state === 'enabled';
  }
}

export const extensionPlatform = new ExtensionPlatform();

/**
 * Extension SDK — the interface extensions use to interact with the kernel.
 * Extensions NEVER manipulate balances directly. They submit Intents.
 */
export interface ExtensionSDK {
  converge(intent: unknown): Promise<unknown>;
  registerEntity(entity: unknown): void;
  on(eventType: string, handler: (event: { type: string; payload: Record<string, unknown> }) => void): void;
  emit(event: { type: string; payload: Record<string, unknown> }): void;
  query(filter: (e: unknown) => boolean): unknown[];
  capabilities: { list(): { name: string; label: string }[] };
}

/** Create an SDK instance for an extension. */
export function createExtensionSDK(extensionId: string): ExtensionSDK {
  return {
    converge: async (intent: unknown) => {
      // In production, this calls kernel.converge(intent)
      return { status: 'converged', extensionId };
    },
    registerEntity: (_entity: unknown) => {
      const ext = extensionPlatform.get(extensionId);
      if (ext) ext.entityCount++;
    },
    on: (_eventType: string, _handler: (event: { type: string; payload: Record<string, unknown> }) => void) => {
      // Subscribe to events
    },
    emit: (_event: { type: string; payload: Record<string, unknown> }) => {
      // Emit event to the event store
    },
    query: (_filter: (e: unknown) => boolean) => {
      return [];
    },
    capabilities: {
      list: () => [],
    },
  };
}
