/**
 * Execution Pipeline — the 14-stage spine. (Vocabulary: Execution.)
 *
 * Stages 0-3 are the Intent Engine (handled before the pipeline proper by
 * IntentEngine.ingest). Stages 4-14 are execution stages, each with a
 * registrable handler. M-RT-1 ships no-op handlers; M-RT-2 registers real
 * payment logic.
 *
 * Every stage:
 *   - emits a TraceNode (Inspector)
 *   - may produce a Decision (explainability)
 *   - may append events (Domain or Runtime) to the Event Store
 *   - may pause, continue, or fail (with compensation in later milestones)
 */

import type { RuntimeClock } from '../clock';
import type { Decision } from '../decisions/types';
import type {
  AppendMetadata,
  EventStore,
  StoredEvent,
  UncommittedEvent,
} from '../events';
import type { IntentEngine, MerchantIntent, TypedIntent } from '../intent';
import type { PolicyEngine } from '../policy';
import type { RequestContext } from '../types';
import type { ExecutionTrace } from '../inspector/types';
import { TraceBuilder } from '../inspector/types';

/** The 15 stage ids (0-14), named per the architecture. */
export const PIPELINE_STAGES = [
  'ingest',
  'normalize',
  'resolve',
  'validate',
  'policy',
  'risk_fraud',
  'treasury_reserve',
  'liquidity_market',
  'settlement_planning',
  'execution',
  'ledger',
  'event_emission',
  'projection',
  'notifications',
  'analytics_inspection',
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

/** Human-readable labels for each stage. */
export const STAGE_LABELS: Record<PipelineStageId, string> = {
  ingest: 'Ingest',
  normalize: 'Normalize',
  resolve: 'Resolve',
  validate: 'Validate & Augment',
  policy: 'Policy Evaluation',
  risk_fraud: 'Risk & Fraud',
  treasury_reserve: 'Treasury & Reserve Allocation',
  liquidity_market: 'Liquidity Market (LP Selection)',
  settlement_planning: 'Settlement Planning',
  execution: 'Execution',
  ledger: 'Ledger Posting',
  event_emission: 'Event Emission',
  projection: 'Projection Updates',
  notifications: 'Notifications & Webhooks',
  analytics_inspection: 'Analytics + Inspection',
};

/** The execution stages (4-14) that the Pipeline orchestrates. */
export const EXECUTION_STAGES: PipelineStageId[] = [
  'policy',
  'risk_fraud',
  'treasury_reserve',
  'liquidity_market',
  'settlement_planning',
  'execution',
  'ledger',
  'event_emission',
  'projection',
  'notifications',
  'analytics_inspection',
];

/** Context passed to every stage handler. */
export interface StageContext {
  intent: TypedIntent;
  clock: RuntimeClock;
  eventStore: EventStore;
  policyEngine: PolicyEngine;
  trace: TraceBuilder;
  /** Scratch state shared across stages in one execution. */
  state: Record<string, unknown>;
  /** Events accumulated by stages, flushed at the event_emission stage. */
  pendingEvents: UncommittedEvent[];
  /** Decisions recorded by stages. */
  decisions: Decision[];
  /** Stored events from this execution (filled as they append). */
  storedEvents: StoredEvent[];
}

/** The outcome a stage handler returns. */
export interface StageOutcome {
  status: 'continue' | 'pause' | 'fail';
  decision?: Decision;
  events?: UncommittedEvent[];
  reason?: string;
}

/** A handler for one execution stage. */
export type StageHandler = (ctx: StageContext) => Promise<StageOutcome> | StageOutcome;

/** The result of a full pipeline dispatch. */
export interface ExecutionResult {
  intent: TypedIntent;
  trace: ExecutionTrace;
  decisions: Decision[];
  events: StoredEvent[];
  status: 'completed' | 'failed' | 'paused';
  error?: { stage: string; message: string };
}
