/**
 * Capability Discovery Engine. (Final Amendment §7H.)
 *
 * Continuously asks: "what capability is missing?" Detects latent capabilities
 * an LP could expose and generates Recommendations.
 *
 * M-RT-1 ships a no-op interface. M-RT-6 implements the real discoverer.
 */

import type { Recommendation } from '../opportunity-discovery/types';
import type { Route } from '../../graphs/route/types';

export interface CapabilityDiscoveryEngine {
  /** Discover all missing-capability opportunities. */
  discover(): Promise<Recommendation[]>;
  /** For a specific LP: what capabilities could it add? */
  forLP(lpId: string): Promise<Recommendation[]>;
  /** Latent composite routes enabled by a (hypothetical) new capability. */
  latentRoutes(capabilityId: string): Promise<Route[]>;
}

/** No-op placeholder (M-RT-1). M-RT-6 implements the real discoverer. */
export class NoOpCapabilityDiscoveryEngine implements CapabilityDiscoveryEngine {
  async discover(): Promise<Recommendation[]> { return []; }
  async forLP(): Promise<Recommendation[]> { return []; }
  async latentRoutes(): Promise<Route[]> { return []; }
}
