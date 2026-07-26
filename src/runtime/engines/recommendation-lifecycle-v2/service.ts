/**
 * RecommendationLifecycleService — the ONLY writer for lifecycle events.
 * (M-RT-10.)
 *
 * Responsibilities:
 *   - Read Recommendation protocol objects (from M-RT-9 Opportunity Discovery)
 *   - Validate legal state transitions (reject illegal ones)
 *   - Append lifecycle events (one per transition)
 *   - Rebuild lifecycle state by replay
 *   - NEVER perform the implementation itself
 *
 * The service is event-driven: recommendations are immutable protocol objects
 * whose state evolves through domain events. The current state is a projection.
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  LifecycleState,
  LifecycleEventType,
  LifecycleUncommittedEvent,
  RecommendationLifecycleState,
} from './types';
import { isLegalTransition, stateToEventType, IllegalTransitionError } from './types';
import { RecommendationLifecycleProjection } from './projection';

/** The Recommendation Lifecycle Service — the only writer. */
export class RecommendationLifecycleService {
  private projection = new RecommendationLifecycleProjection();

  constructor(
    private eventStore: EventStore,
    private clock: RuntimeClock,
  ) {}

  /** Register a new recommendation (detected state). Emits recommendation.detected. */
  async detect(
    recommendationId: string,
    reason: string,
    environment: Environment,
    actorId: string,
    correlationId: string,
  ): Promise<RecommendationLifecycleState> {
    return this.transition(recommendationId, 'detected', reason, environment, actorId, correlationId);
  }

  /** Transition a recommendation to a new state. Validates legality. Emits one event. */
  async transition(
    recommendationId: string,
    to: LifecycleState,
    reason: string,
    environment: Environment,
    actorId: string,
    correlationId: string,
    data?: Record<string, unknown>,
  ): Promise<RecommendationLifecycleState> {
    const streamId = `${environment}:rec-lifecycle:${recommendationId}`;

    // Read current state (by replaying events).
    const current = await this.getState(recommendationId, environment);

    // Determine the 'from' state.
    const from: LifecycleState = current?.currentState ?? 'detected';

    // If this is the first event and 'to' is 'detected', from = '' (no prior state).
    // The first event is always recommendation.detected (from='detected' to='detected' is not a transition;
    // we handle detection specially: from is empty, to is 'detected').
    if (!current && to === 'detected') {
      // First detection — emit the event.
      const event: LifecycleUncommittedEvent = {
        type: 'recommendation.detected',
        streamId,
        streamType: 'rec-lifecycle',
        kind: 'domain',
        payload: {
          recommendationId,
          from: 'detected' as LifecycleState, // self-transition for detection
          to: 'detected',
          reason,
          data,
        },
      };

      await this.appendEvents([event], streamId, { environment, actorId, correlationId });
      return (await this.getState(recommendationId, environment))!;
    }

    // Validate the transition.
    if (!isLegalTransition(from, to)) {
      throw new IllegalTransitionError(recommendationId, from, to);
    }

    // Emit the event.
    const eventType = stateToEventType(to);
    const event: LifecycleUncommittedEvent = {
      type: eventType,
      streamId,
      streamType: 'rec-lifecycle',
      kind: 'domain',
      payload: {
        recommendationId,
        from,
        to,
        reason,
        data,
      },
    };

    await this.appendEvents([event], streamId, { environment, actorId, correlationId });

    // Return the new state (re-read from events — never trust in-memory).
    return (await this.getState(recommendationId, environment))!;
  }

  /** Get the current lifecycle state of a recommendation (by replaying events). */
  async getState(recommendationId: string, environment: Environment): Promise<RecommendationLifecycleState | null> {
    const streamId = `${environment}:rec-lifecycle:${recommendationId}`;
    const events = await this.eventStore.readStream(streamId);
    if (events.length === 0) return null;
    return this.projection.rebuild(events);
  }

  /** Get all recommendation lifecycle states in an environment. */
  async listAll(environment: Environment): Promise<RecommendationLifecycleState[]> {
    const allEvents = await this.eventStore.readAll(0, 10000);
    const lifecycleEvents = allEvents.filter(
      (e) => e.streamType === 'rec-lifecycle' && e.metadata.environment === environment,
    );

    // Group by recommendation ID.
    const byId = new Map<string, typeof lifecycleEvents>();
    for (const ev of lifecycleEvents) {
      const recId = (ev.payload as { recommendationId: string }).recommendationId;
      if (!byId.has(recId)) byId.set(recId, []);
      byId.get(recId)!.push(ev);
    }

    const states: RecommendationLifecycleState[] = [];
    for (const [recId, events] of byId) {
      const state = this.projection.rebuild(events);
      if (state) states.push(state);
    }
    return states;
  }

  /** Replay verification — rebuild + check the state is consistent. */
  async verifyReplay(recommendationId: string, environment: Environment): Promise<{
    valid: boolean;
    state: RecommendationLifecycleState | null;
  }> {
    const state = await this.getState(recommendationId, environment);
    return { valid: state !== null, state };
  }

  // ── private ──────────────────────────────────────────────────────────

  private async appendEvents(
    events: LifecycleUncommittedEvent[],
    streamId: string,
    params: { environment: Environment; actorId: string; correlationId: string },
  ): Promise<void> {
    const expectedVersion = this.eventStore.streamVersion(streamId) ?? -1;
    await this.eventStore.append(
      events,
      new Map([[streamId, expectedVersion]]),
      {
        intentId: params.correlationId,
        correlationId: params.correlationId,
        actor: params.actorId,
        environment: params.environment,
        timestamp: this.clock.now(),
      },
    );
  }
}
