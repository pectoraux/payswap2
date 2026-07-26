/**
 * Capability Graph — what each LP CAN do. (Final Amendment §7G.)
 *
 * The crucial split: capabilities (what's possible) are separate from routes
 * (what currently exists). Every LP capability is an explicit, discoverable
 * object. The Route Graph (§7G) is generated FROM this graph.
 *
 * M-RT-1 ships types + an in-memory graph. M-RT-2 implements the real
 * capability publisher (LPs publish capabilities via Intents).
 */

import type { Rail } from '../../engines/liquidity-market/types';

/** One LP capability — a single edge the LP can perform. */
export interface LPCapability {
  id: string;
  lpId: string;
  /** Source currency or twin-currency (e.g. 'GHS', 'TwinGHS'). */
  from: string;
  /** Destination currency or twin-currency (e.g. 'TwinGHS', 'XOF'). */
  to: string;
  rail: Rail;
  maxAmount: number;
  latencyMs: number;
  active: boolean;
  publishedAt: number;
}

/** The Capability Graph — what each LP CAN do. Source of truth for "what's possible." */
export interface CapabilityGraph {
  /** An LP publishes a capability. */
  publish(capability: LPCapability): void;
  /** An LP withdraws a capability. */
  withdraw(capabilityId: string): void;
  /** All capabilities of one LP. */
  forLP(lpId: string): LPCapability[];
  /** All LPs that can move from→to (directly). */
  canMove(from: string, to: string): LPCapability[];
  /** All capabilities. */
  all(): LPCapability[];
}

/** In-memory Capability Graph (M-RT-1). */
export class InMemoryCapabilityGraph implements CapabilityGraph {
  private byId: Map<string, LPCapability> = new Map();

  publish(capability: LPCapability): void {
    this.byId.set(capability.id, capability);
  }

  withdraw(capabilityId: string): void {
    this.byId.delete(capabilityId);
  }

  forLP(lpId: string): LPCapability[] {
    return [...this.byId.values()].filter((c) => c.lpId === lpId && c.active);
  }

  canMove(from: string, to: string): LPCapability[] {
    return [...this.byId.values()].filter(
      (c) => c.active && c.from === from && c.to === to,
    );
  }

  all(): LPCapability[] {
    return [...this.byId.values()].filter((c) => c.active);
  }
}
