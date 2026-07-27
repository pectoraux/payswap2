/**
 * Corridor Discovery Engine. (Final Amendment §7I.)
 *
 * Discovers corridors that do not yet exist (demand with no direct route),
 * proposes composite paths, and recommends opening with quantified estimates.
 *
 * M-RT-1 ships a no-op interface. M-RT-6 implements the real discoverer.
 */

import type { Recommendation } from '../opportunity-discovery/types';
import type { Route } from '../../graphs/route/types';

export interface CorridorDiscoveryEngine {
  /** Discover all missing-corridor opportunities. */
  discover(): Promise<Recommendation[]>;
  /** For a demand signal (from→to with no direct route), propose a corridor. */
  proposeCorridor(from: string, to: string): Promise<Recommendation>;
  /** Composite paths that would work if the corridor opened. */
  candidatePaths(from: string, to: string): Promise<Route[]>;
}

/** No-op placeholder (M-RT-1). M-RT-6 implements the real discoverer. */
export class NoOpCorridorDiscoveryEngine implements CorridorDiscoveryEngine {
  async discover(): Promise<Recommendation[]> { return []; }
  async proposeCorridor(from: string, _to: string): Promise<Recommendation> {
    return {
      id: `rec_corridor_${from}_${_to}`,
      version: 1,
      type: 'missing_corridor',
      audience: 'lp',
      title: `Open corridor ${from}→${_to}`,
      description: 'No-op placeholder.',
      subject: `corridor:${from}-${_to}`,
      estimatedImpact: [],
      confidence: 0,
      requiredAction: '',
      evidence: [],
      status: 'proposed',
      createdAt: 0,
    };
  }
  async candidatePaths(): Promise<Route[]> { return []; }
}
