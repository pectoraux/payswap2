/**
 * Economic Composition Engine — Type Definitions.
 *
 * PaySwap extensions are autonomous economic actors. They exchange standardized
 * tokens and events (contracts) rather than calling each other directly. Every
 * new extension increases the value of the existing ecosystem rather than
 * adding an isolated feature.
 *
 * Five concepts:
 *   1. Extensions are bounded economic entities (identity + treasury + reputation + capabilities + token defs + event subs).
 *   2. Tokens are programmable rights — not just money (reputation, collateral, identity, reserve certs, credits).
 *   3. Tokens emit events (mint → event bus → interested extensions react).
 *   4. Tokens are consumable (an extension can require/consume another extension's token).
 *   5. Composable workflows — one payment triggers a cascade of token emissions across extensions.
 *
 * This module is a NEW layer parallel to src/runtime/, src/claims/, src/lp/, src/treasury/.
 * It does NOT modify the Prisma schema (constraint: frozen). All records live in a
 * process-wide singleton on globalThis so Next.js dev-mode module re-instantiation
 * does not lose data.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TOKENS — programmable rights issued by extensions
// ═══════════════════════════════════════════════════════════════════════════

export type TokenKind = 'FUNGIBLE' | 'NON_FUNGIBLE' | 'SOULBOUND';

export type HolderType = 'EXTENSION' | 'USER' | 'MERCHANT' | 'CUSTOMER' | 'TREASURY' | 'LP';

/**
 * A token definition — a programmable right issued by an extension.
 * Token ids are dot-namespaced: `identity.verified`, `marketplace.reward`.
 */
export interface TokenDefinition {
  id: string;              // 'identity.verified'
  symbol: string;          // 'VID'
  name: string;            // 'Verified Identity Token'
  issuer: string;          // extension id that mints this ('identity')
  kind: TokenKind;
  consumable: boolean;     // can other extensions consume this?
  description: string;
  color: string;           // tailwind hue for UI ('emerald' | 'amber' | 'sky' | ...)
  totalSupply: number;     // updated on mint/burn
  holderCount: number;     // distinct holders
  mintCount: number;
  burnCount: number;
  consumeCount: number;
  createdAt: number;
}

/** A token balance held by an extension or real-world entity. */
export interface TokenBalance {
  tokenId: string;
  holderId: string;
  holderType: HolderType;
  holderLabel: string;     // human-readable
  balance: number;
  consumed: number;        // cumulative consumed
  updatedAt: number;
}

export type TokenOpType = 'MINT' | 'BURN' | 'TRANSFER' | 'CONSUME';

/** An immutable token lifecycle operation. */
export interface TokenOperation {
  id: string;
  tokenId: string;
  tokenSymbol: string;
  type: TokenOpType;
  from?: string;           // holderId (burn/transfer/consume)
  to?: string;             // holderId (mint/transfer)
  toType?: HolderType;
  amount: number;
  reason: string;
  eventId: string;         // the economic event this op emitted
  pipelineId?: string;     // if triggered by a pipeline
  ts: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC EVENTS — the composition bus
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An economic event flowing through the composition bus. Token lifecycle
 * operations emit events; extensions subscribe to events and react; pipelines
 * are triggered by events. Events are the only coupling between extensions.
 */
export interface EconomicEvent {
  id: string;
  type: string;            // 'token.minted' | 'payment.completed' | 'sale.completed' | ...
  source: string;          // extension id or 'system' or 'pipeline'
  tokenId?: string;        // if this is a token lifecycle event
  tokenSymbol?: string;
  payload: Record<string, unknown>;
  ts: number;
  reactors: string[];      // extension ids that reacted to this event
  cascaded: boolean;       // did this event trigger pipelines?
}

export type EventSubscriber = (event: EconomicEvent) => void | Promise<void>;

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSIONS — autonomous economic actors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The economic manifest of an extension. Extensions declare the contracts
 * they participate in (tokens emitted/consumed, events published/subscribed)
 * rather than depending on other extensions directly.
 */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;        // 'identity' | 'marketplace' | 'lending' | ...
  tokens: {
    emits: string[];       // token ids this extension mints
    consumes: string[];    // token ids this extension requires/consumes
  };
  events: {
    publishes: string[];   // event types this extension emits
    subscribes: string[];  // event types this extension reacts to
  };
  capabilities: string[];  // capability strings ('marketplace.list', 'identity.verify', ...)
}

export type ExtensionStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

/**
 * An extension as a bounded economic entity — a micro-business inside PaySwap.
 */
export interface EconomicExtension {
  id: string;
  name: string;
  version: string;
  status: ExtensionStatus;
  category: string;
  description: string;
  manifest: ExtensionManifest;
  reputation: number;                 // 0–100
  treasury: Record<string, number>;   // tokenId -> balance (the extension's own holdings)
  eventsPublished: number;
  eventsConsumed: number;
  tokensMinted: number;
  tokensConsumed: number;
  registeredAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN PIPELINES — declarative composable workflows
// ═══════════════════════════════════════════════════════════════════════════

export type PipelineStepAction =
  | 'mint' | 'burn' | 'consume' | 'transfer'
  | 'notify' | 'publish' | 'wait' | 'condition';

/** A single declarative step in a token pipeline. */
export interface PipelineStep {
  action: PipelineStepAction;
  token?: string;          // for mint/burn/consume/transfer
  amount?: number | string; // number, or template '${event.payload.amount}'
  target?: string;         // holderId for mint/transfer ('${event.payload.customerId}')
  targetType?: HolderType;
  event?: string;          // for publish/notify
  payload?: Record<string, unknown>;
  condition?: string;      // for condition step (expression evaluated against event payload)
  label?: string;          // human-readable step label
}

export type PipelineStatus = 'ACTIVE' | 'PAUSED';

/** A declarative token pipeline triggered by an economic event. */
export interface TokenPipeline {
  id: string;
  name: string;
  description: string;
  trigger: string;         // event type that fires this pipeline
  filter?: Record<string, unknown>; // optional payload match filter
  steps: PipelineStep[];
  status: PipelineStatus;
  executions: number;
  successes: number;
  failures: number;
  lastExecutedAt?: number;
  createdAt: number;
}

export type PipelineStepStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'RUNNING';

export interface PipelineStepResult {
  stepIndex: number;
  action: PipelineStepAction;
  label?: string;
  status: PipelineStepStatus;
  detail: string;
  ts: number;
}

export type PipelineExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

/** An execution trace of a pipeline run. */
export interface PipelineExecution {
  id: string;
  pipelineId: string;
  pipelineName: string;
  trigger: string;
  triggerEvent: {
    type: string;
    source: string;
    payload: Record<string, unknown>;
    ts: number;
  };
  steps: PipelineStepResult[];
  status: PipelineExecutionStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  cascadeDepth: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPENDENCY GRAPH — the economic composition topology
// ═══════════════════════════════════════════════════════════════════════════

export type GraphNodeKind = 'EXTENSION' | 'TOKEN' | 'EVENT' | 'PIPELINE';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  group?: string;          // extension category or token issuer
  color?: string;
}

export type GraphEdgeKind =
  | 'EMITS'        // extension → token (the extension mints this token)
  | 'CONSUMES'     // extension → token (the extension requires this token)
  | 'PUBLISHES'    // extension → event
  | 'SUBSCRIBES'   // extension → event
  | 'TRIGGERS';    // event → pipeline

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface EconomicGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW — KPI aggregates for the dashboard
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicOverview {
  extensionCount: number;
  activeExtensionCount: number;
  tokenCount: number;
  totalSupply: number;
  pipelineCount: number;
  activePipelineCount: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  eventCount: number;
  cascadedEvents: number;
  operationCount: number;
}
