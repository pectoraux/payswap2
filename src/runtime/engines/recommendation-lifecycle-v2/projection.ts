/**
 * RecommendationLifecycleProjection — rebuilds lifecycle state from the event
 * stream. (M-RT-10.)
 *
 * Same projection discipline as every other primitive: the lifecycle state is
 * NEVER mutated directly. It is derived from domain events by replay.
 */

import type { StoredEvent } from '../../events';
import type {
  LifecycleEventRecord,
  RecommendationLifecycleState,
  LifecycleState,
} from './types';

export class RecommendationLifecycleProjection {
  /** Rebuild the lifecycle state for one recommendation from its event stream. */
  rebuild(events: StoredEvent[]): RecommendationLifecycleState | null {
    if (events.length === 0) return null;

    const history: LifecycleEventRecord[] = [];
    let currentState: LifecycleState = 'detected';
    let detectedAt = 0;
    let lastTransitionAt = 0;
    let score: number | undefined;
    let measurement: { actualVolumeDelta: number; actualRevenueDelta: number; actualCostDeltaBps: number } | undefined;

    for (const event of events) {
      const payload = event.payload as {
        recommendationId: string;
        from: LifecycleState;
        to: LifecycleState;
        reason: string;
        data?: Record<string, unknown>;
      };

      const record: LifecycleEventRecord = {
        recommendationId: payload.recommendationId,
        from: payload.from,
        to: payload.to,
        eventType: event.type as never,
        reason: payload.reason,
        data: payload.data,
        ts: event.metadata.timestamp,
        version: event.version,
      };

      history.push(record);
      currentState = payload.to;
      lastTransitionAt = event.metadata.timestamp;

      if (payload.from === 'detected' && payload.to === 'scored') {
        detectedAt = events[0]?.metadata.timestamp ?? event.metadata.timestamp;
      }

      // Capture score at the 'scored' transition.
      if (payload.to === 'scored' && payload.data?.score !== undefined) {
        score = payload.data.score as number;
      }

      // Capture measurement at the 'measured' transition.
      if (payload.to === 'measured' && payload.data) {
        measurement = {
          actualVolumeDelta: (payload.data.actualVolumeDelta as number) ?? 0,
          actualRevenueDelta: (payload.data.actualRevenueDelta as number) ?? 0,
          actualCostDeltaBps: (payload.data.actualCostDeltaBps as number) ?? 0,
        };
      }
    }

    // Set detectedAt from the first event.
    if (detectedAt === 0 && events.length > 0) {
      detectedAt = events[0].metadata.timestamp;
    }

    return {
      recommendationId: history[0].recommendationId,
      currentState,
      history,
      detectedAt,
      lastTransitionAt,
      score,
      measurement,
    };
  }
}
