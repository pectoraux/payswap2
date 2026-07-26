/**
 * Recommendation Lifecycle v2 — event-driven lifecycle management. (M-RT-10.)
 *
 * Responsibility: lifecycle management ONLY. Not discovery (that's M-RT-9
 * Opportunity Discovery). Not execution (that's future pipeline work).
 *
 * Recommendations are immutable protocol objects whose *state* evolves through
 * domain events — not in-place mutation. The current state is rebuilt as a
 * projection from the event stream.
 *
 * Lifecycle:
 *   Detected → Scored → Simulated → Recommended → Accepted →
 *   Implemented → Observed → Measured → Learned
 *
 * Each transition = one domain event. Invalid transitions are rejected.
 * The service validates legal transitions, appends events, and rebuilds by
 * replay. It NEVER performs the implementation itself.
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';

// ─── Lifecycle states ───────────────────────────────────────────────────────

export type LifecycleState =
  | 'detected'     // Opportunity Discovery found it
  | 'scored'       // Economic Score + confidence assigned
  | 'simulated'    // Counterfactual run
  | 'recommended'  // Presented to the audience
  | 'accepted'     // Actor accepted
  | 'implemented'  // Action taken (by an actor, NOT by this service)
  | 'observed'     // Post-implementation observation window
  | 'measured'     // ImpactMeasurement recorded
  | 'learned';     // Learning stored in Runtime Memory

/** The 9 lifecycle event types — one per transition. */
export type LifecycleEventType =
  | 'recommendation.detected'
  | 'recommendation.scored'
  | 'recommendation.simulated'
  | 'recommendation.recommended'
  | 'recommendation.accepted'
  | 'recommendation.implemented'
  | 'recommendation.observed'
  | 'recommendation.measured'
  | 'recommendation.learned';

/** The legal transition map (from → to). */
export const LEGAL_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  detected:     ['scored'],
  scored:       ['simulated', 'recommended'],  // can skip simulation if no twin
  simulated:    ['recommended'],
  recommended:  ['accepted', 'learned'],       // can be rejected (→ learned as "rejected")
  accepted:     ['implemented', 'learned'],     // can be revoked (→ learned as "revoked")
  implemented:  ['observed'],
  observed:     ['measured'],
  measured:     ['learned'],
  learned:      [],                              // terminal
};

/** Check if a transition is legal. Pure. */
export function isLegalTransition(from: LifecycleState, to: LifecycleState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/** The payload of a lifecycle event. */
export interface LifecycleEventPayload {
  recommendationId: string;
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
  /** Optional data attached to the transition (e.g. score, measurement). */
  data?: Record<string, unknown>;
}

/** An uncommitted lifecycle event. */
export interface LifecycleUncommittedEvent {
  type: LifecycleEventType;
  streamId: string;           // `${environment}:rec-lifecycle:${recommendationId}`
  streamType: 'rec-lifecycle';
  kind: 'domain';
  payload: LifecycleEventPayload & Record<string, unknown>;
}

// ─── Lifecycle state (the projection) ───────────────────────────────────────

/** A lifecycle event record (stored). */
export interface LifecycleEventRecord {
  recommendationId: string;
  from: LifecycleState;
  to: LifecycleState;
  eventType: LifecycleEventType;
  reason: string;
  data?: Record<string, unknown>;
  ts: number;
  version: number;
}

/** The current lifecycle state of a recommendation — rebuilt from events. */
export interface RecommendationLifecycleState {
  recommendationId: string;
  currentState: LifecycleState;
  history: LifecycleEventRecord[];
  detectedAt: number;
  lastTransitionAt: number;
  /** The score attached at the 'scored' stage (if any). */
  score?: number;
  /** The measurement attached at the 'measured' stage (if any). */
  measurement?: { actualVolumeDelta: number; actualRevenueDelta: number; actualCostDeltaBps: number };
}

/** Thrown when a transition is illegal. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly recommendationId: string,
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`Illegal transition for ${recommendationId}: ${from} → ${to}. Legal: ${(LEGAL_TRANSITIONS[from] ?? []).join(', ') || '(terminal)'}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Map a state to its event type. Pure. */
export function stateToEventType(state: LifecycleState): LifecycleEventType {
  const map: Record<LifecycleState, LifecycleEventType> = {
    detected: 'recommendation.detected',
    scored: 'recommendation.scored',
    simulated: 'recommendation.simulated',
    recommended: 'recommendation.recommended',
    accepted: 'recommendation.accepted',
    implemented: 'recommendation.implemented',
    observed: 'recommendation.observed',
    measured: 'recommendation.measured',
    learned: 'recommendation.learned',
  };
  return map[state];
}
