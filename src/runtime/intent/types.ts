/**
 * Intent — the universal input. (Principle 2: Intent Before Execution;
 * Vocabulary: Intent.)
 *
 * An Intent is separated from a Command. A Command says "do X"; an Intent
 * says "I want outcome Y, here is my understanding of the situation, please
 * figure out how." The Intent Engine normalizes, resolves, validates, and
 * augments a MerchantIntent into a TypedIntent before any pipeline stage runs.
 *
 * Eight intent kinds cover every financial operation:
 *   payment · refund · transfer · settlement · mint · reserve · liquidity · treasury
 */

import type {
  Actor,
  Environment,
  EvidenceCitation,
  FailureInjection,
  IntentSource,
  RequestContext,
} from '../types';

export type IntentKind =
  | 'payment'
  | 'refund'
  | 'transfer'
  | 'settlement'
  | 'mint'
  | 'reserve'
  | 'liquidity'
  | 'treasury';

/** A raw request from a client, before normalization. */
export interface MerchantIntent {
  kind: IntentKind;
  raw: Record<string, unknown>;
}

/** After normalization: canonical amounts/currencies/casing. */
export interface NormalizedIntent {
  kind: IntentKind;
  data: Record<string, unknown>;
}

/** After resolution: references ("Alice") resolved to concrete IDs. */
export interface ResolvedIntent {
  kind: IntentKind;
  data: Record<string, unknown>;
  resolved: Record<string, unknown>;
}

/** A validation result. */
export interface IntentValidationResult {
  valid: boolean;
  errors: string[];
}

/** Constraints an intent carries into the pipeline. */
export interface IntentConstraints {
  maxCostBps?: number;
  maxRisk?: number;
  deadline?: number;
  [key: string]: unknown;
}

/**
 * TypedIntent — the serializable, replayable, inspectable input the pipeline
 * accepts. This is the artifact stored alongside the execution trace.
 */
export interface TypedIntent {
  id: string;
  kind: IntentKind;
  actor: Actor;
  environment: Environment;
  /** Resolved subject (customer id, payment id, wallet id, …). */
  subject: Record<string, unknown>;
  /** Desired outcome (amount, currency, corridor, method, …). */
  desired: Record<string, unknown>;
  constraints: IntentConstraints;
  evidence: EvidenceCitation[];
  correlationId: string;
  causationId?: string;
  source: IntentSource;
  failureInjection?: FailureInjection;
  /** Runtime Clock time the intent was created. */
  createdAt: number;
}

/** Thrown when intent validation fails. */
export class IntentValidationError extends Error {
  constructor(readonly result: IntentValidationResult) {
    super(`Intent validation failed: ${result.errors.join('; ')}`);
    this.name = 'IntentValidationError';
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a RequestContext for a dispatch. */
export function requestContext(params: {
  actor: Actor;
  environment: Environment;
  source: IntentSource;
  correlationId?: string;
  causationId?: string;
}): RequestContext {
  return {
    actor: params.actor,
    environment: params.environment,
    source: params.source,
    correlationId: params.correlationId ?? `corr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    causationId: params.causationId,
  };
}
