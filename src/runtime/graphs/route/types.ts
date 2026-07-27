/**
 * Route Graph — what routes currently exist. (Final Amendment §7G.)
 *
 * Generated FROM the Capability Graph, never manually maintained. When an LP
 * publishes/withdraws a capability, the Route Graph updates automatically.
 * 1 hop = direct route; N hops = composite route.
 *
 * M-RT-1 ships types + an in-memory graph with trivial 1-hop generation.
 * M-RT-4 implements full regeneration (incl. multi-hop composition).
 */

import type { LPCapability } from '../capability/types';

/** One hop in a route (references a capability + its owner). */
export interface RouteHop {
  ownerId: string;
  ownerType: string;   // 'lp' | 'treasury' | ...
  capabilityId: string;
}

/** A route — direct (1 hop) or composite (N hops). Generated from capabilities. */
export interface Route {
  id: string;
  from: string;
  to: string;
  hops: RouteHop[];
  isDirect: boolean;
  generatedFrom: string[];   // capability ids
  active: boolean;
}

/** The Route Graph — what's routable right now. */
export interface RouteGraph {
  /** Regenerate routes from the current Capability Graph. */
  regenerate(capabilities: LPCapability[]): Promise<void>;
  /** Direct routes from→to. */
  direct(from: string, to: string): Route[];
  /** Multi-hop routes from→to (up to maxHops). */
  multiHop(from: string, to: string, maxHops?: number): Route[];
  /** All routes from→to (direct + multi-hop). */
  all(from: string, to: string): Route[];
}

/**
 * In-memory Route Graph (M-RT-1). M-RT-1 generates only direct (1-hop)
 * routes; multi-hop composition is deferred to M-RT-4/M-RT-16.
 */
export class InMemoryRouteGraph implements RouteGraph {
  private routesByKey: Map<string, Route> = new Map();

  async regenerate(capabilities: LPCapability[]): Promise<void> {
    this.routesByKey.clear();
    // M-RT-1: generate direct (1-hop) routes only.
    for (const cap of capabilities) {
      if (!cap.active) continue;
      const key = `${cap.ownerId}:${cap.from}->${cap.to}`;
      this.routesByKey.set(key, {
        id: `route_${key}`,
        from: cap.from,
        to: cap.to,
        hops: [{ ownerId: cap.ownerId, ownerType: cap.ownerType, capabilityId: cap.id }],
        isDirect: true,
        generatedFrom: [cap.id],
        active: true,
      });
    }
  }

  direct(from: string, to: string): Route[] {
    return [...this.routesByKey.values()].filter(
      (r) => r.active && r.isDirect && r.from === from && r.to === to,
    );
  }

  multiHop(): Route[] {
    // M-RT-1: no multi-hop generation yet. M-RT-4/M-RT-16 implement this.
    return [];
  }

  all(from: string, to: string): Route[] {
    return [...this.routesByKey.values()].filter(
      (r) => r.active && r.from === from && r.to === to,
    );
  }
}
