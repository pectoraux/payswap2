/**
 * Counterfactual Engine. (Final Amendment §7N.)
 *
 * Powers the Digital Twin's counterfactual evolution and the Recommendation
 * "Simulated" lifecycle stage. Compares the Current Network vs an Alternative
 * Network across revenue/volume/latency/capital/reserve-utilization.
 *
 * M-RT-1 ships a no-op interface. M-RT-10 implements the real engine.
 */

export type NetworkMutationKind =
  | 'add_capability'
  | 'remove_capability'
  | 'add_reserve'
  | 'resize_reserve'
  | 'add_lp'
  | 'remove_lp'
  | 'change_pricing'
  | 'fx_shock';

export interface NetworkMutation {
  kind: NetworkMutationKind;
  target: string;
  params: Record<string, unknown>;
}

export interface CounterfactualHypothesis {
  description: string;          // "LP A funds XOF reserve"
  mutations: NetworkMutation[]; // the changes to apply to the network
  durationMs: number;           // how long to simulate
}

export interface NetworkSnapshot {
  revenue: number;
  volume: number;
  avgLatencyMs: number;
  capitalDeployed: number;
  reserveUtilization: Record<string, number>;
  corridorCount: number;
  lpCount: number;
}

export interface Counterfactual {
  hypothesis: string;
  baseline: NetworkSnapshot;     // Current Network
  alternative: NetworkSnapshot;  // Alternative Network
  deltas: {
    revenue: number;
    volume: number;
    latency: number;
    capital: number;
    reserveUtilization: Record<string, number>;
  };
  confidence: number;
  simulatedAt: number;
}

export interface CounterfactualEngine {
  /** "What if this hypothesis were true?" Compare Current vs Alternative Network. */
  evaluate(hypothesis: CounterfactualHypothesis): Promise<Counterfactual>;
}

/** No-op placeholder (M-RT-1). M-RT-10 implements the real engine. */
export class NoOpCounterfactualEngine implements CounterfactualEngine {
  async evaluate(hypothesis: CounterfactualHypothesis): Promise<Counterfactual> {
    const empty: NetworkSnapshot = {
      revenue: 0, volume: 0, avgLatencyMs: 0, capitalDeployed: 0,
      reserveUtilization: {}, corridorCount: 0, lpCount: 0,
    };
    return {
      hypothesis: hypothesis.description,
      baseline: empty,
      alternative: empty,
      deltas: { revenue: 0, volume: 0, latency: 0, capital: 0, reserveUtilization: {} },
      confidence: 0,
      simulatedAt: 0,
    };
  }
}
