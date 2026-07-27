/**
 * RouteCompiler — compiles the Route Graph from the Capability Graph.
 * (M-RT-6.)
 *
 * The Route Graph is a COMPILED PROJECTION, never an authoritative store.
 * It is derived from the Capability Graph (connectivity only — no economics).
 * Always rebuildable from its inputs. Does NOT "know" economics.
 *
 * M-RT-6: generates direct (1-hop) routes. Multi-hop composition (Route
 * Synthesis) is deferred to M-RT-19 (future).
 */

import type { LPCapability, CapabilityGraph } from '../../graphs/capability/types';
import type { Route, RouteHop, RouteGraph } from './types';
import { validateRoute } from './types';

/** Compile routes from a list of capabilities. Pure, deterministic. */
export class RouteCompiler {
  /** Compile all direct routes from active capabilities. */
  compile(capabilities: LPCapability[], compiledAt: number): Route[] {
    const routes: Route[] = [];

    for (const cap of capabilities) {
      if (!cap.active) continue;

      const hop: RouteHop = {
        ownerId: cap.ownerId,
        ownerType: cap.ownerType,
        capabilityId: cap.id,
        from: cap.from,
        to: cap.to,
      };

      const route: Route = {
        id: `route_${cap.ownerId}_${cap.from}_${cap.to}`,
        from: cap.from,
        to: cap.to,
        hops: [hop],
        isDirect: true,
        isMultiHop: false,
        hopCount: 1,
        generatedFrom: [cap.id],
        active: true,
      };

      // Validate the route (enforce invariants).
      const violations = validateRoute(route);
      if (violations.length === 0) {
        routes.push(route);
      }
    }

    return routes;
  }

  /** Rebuild the Route Graph from the Capability Graph. */
  rebuild(capabilityGraph: CapabilityGraph, compiledAt: number): RouteGraph {
    const capabilities = capabilityGraph.all();
    const routes = this.compile(capabilities, compiledAt);

    return {
      routes,
      direct(from: string, to: string): Route[] {
        return routes.filter((r) => r.from === from && r.to === to);
      },
      all(from: string, to: string): Route[] {
        // M-RT-6: direct only. Multi-hop deferred to M-RT-19.
        return routes.filter((r) => r.from === from && r.to === to);
      },
    };
  }
}
