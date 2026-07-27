// Recommendation Lifecycle v2 — event-driven lifecycle management. (M-RT-10.)
export type {
  LifecycleState,
  LifecycleEventType,
  LifecycleEventPayload,
  LifecycleUncommittedEvent,
  LifecycleEventRecord,
  RecommendationLifecycleState,
} from './types';
export {
  LEGAL_TRANSITIONS,
  isLegalTransition,
  stateToEventType,
  IllegalTransitionError,
} from './types';
export { RecommendationLifecycleProjection } from './projection';
export { RecommendationLifecycleService } from './service';
