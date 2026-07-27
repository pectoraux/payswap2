/**
 * PaySwap Runtime — core shared types.
 *
 * These types are the connective tissue every runtime submodule uses. They
 * intentionally mirror the frozen Runtime Vocabulary
 * (PROTOCOL-RUNTIME-ARCHITECTURE.md → "Runtime Vocabulary").
 *
 * The runtime is built ABOVE the frozen kernel. It imports kernel *types*
 * (never editing kernel files) and reuses the kernel's pure functions in
 * later milestones. M-RT-1 defines only the skeleton — no business logic.
 */

/** sandbox vs live — same runtime, same code; only data/connectors/credentials/clock differ. */
export type Environment = 'sandbox' | 'live';

/** Who is asking the runtime to do something. */
export interface Actor {
  id: string;
  role: string;
  orgId?: string;
}

/** Where an intent originated. Every client is a peer. */
export type IntentSource =
  | 'dashboard'
  | 'admin'
  | 'twin'
  | 'sdk'
  | 'cli'
  | 'extension'
  | 'ai-agent'
  | 'mobile'
  | 'api';

/** The context carried through one dispatch. */
export interface RequestContext {
  actor: Actor;
  environment: Environment;
  source: IntentSource;
  correlationId: string;
  causationId?: string;
}

/** A reference to evidence cited for a decision (compatible with kernel EvidenceCitation). */
export interface EvidenceCitation {
  source: string;
  ref: string;
  confidence: number;
  note?: string;
}

/** A failure to inject at a pipeline stage (simulator/twin only). */
export interface FailureInjection {
  stage: string;
  type: string;
  label: string;
  atFrame?: number;
}

// ─── small utilities ────────────────────────────────────────────────────────

/** Generate a prefixed unique id. */
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a correlation id for a request. */
export function newCorrelationId(): string {
  return `corr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
