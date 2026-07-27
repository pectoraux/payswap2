/**
 * Protocol Inspector — the trace tree. (Principle 9: Everything Is
 * Inspectable; Vocabulary: Protocol Trace.)
 *
 * Every pipeline stage writes a TraceNode. The Inspector renders the full
 * expandable tree for one execution. M-RT-1 builds the trace in memory;
 * M-RT-8 persists it to a StateTimelineView read model and ships the UI.
 */

import type { Decision } from '../decisions/types';

export type TraceNodeKind =
  | 'intent'
  | 'stage'
  | 'decision'
  | 'event'
  | 'connector'
  | 'ledger'
  | 'reconcile';

export type TraceNodeStatus = 'ok' | 'warn' | 'error' | 'pending' | 'running' | 'skipped';

export interface TraceNode {
  id: string;
  parentId?: string;
  stage: string;
  kind: TraceNodeKind;
  label: string;
  status: TraceNodeStatus;
  startedAt: number;
  durationMs: number;
  detail: Record<string, unknown>;
  children: TraceNode[];
  /** The decision this node produced (if any). */
  decision?: Decision;
}

/** The full trace for one intent execution. */
export interface ExecutionTrace {
  intentId: string;
  correlationId: string;
  status: 'running' | 'completed' | 'failed';
  root: TraceNode;
  /** Flat list of stage nodes, in execution order. */
  stages: TraceNode[];
  startedAt: number;
  finishedAt?: number;
}

/**
 * TraceBuilder — accumulates nodes as the pipeline runs.
 */
export class TraceBuilder {
  root: TraceNode;
  intentId: string;
  private stages: TraceNode[] = [];
  private current: TraceNode | null = null;

  constructor(
    intentId: string,
    readonly correlationId: string,
    startedAt: number,
  ) {
    this.intentId = intentId;
    this.root = {
      id: `node_root_${intentId}`,
      stage: 'root',
      kind: 'intent',
      label: 'Execution',
      status: 'running',
      startedAt,
      durationMs: 0,
      detail: {},
      children: [],
    };
  }

  /** Begin a stage node (child of root). */
  beginStage(stage: string, label: string, startedAt: number): TraceNode {
    const node: TraceNode = {
      id: `node_${stage}_${this.intentId}`,
      parentId: this.root.id,
      stage,
      kind: 'stage',
      label,
      status: 'running',
      startedAt,
      durationMs: 0,
      detail: {},
      children: [],
    };
    this.root.children.push(node);
    this.stages.push(node);
    this.current = node;
    return node;
  }

  /** Finish the current stage node. */
  finishStage(node: TraceNode, status: TraceNodeStatus, finishedAt: number, detail?: Record<string, unknown>): void {
    node.status = status;
    node.durationMs = finishedAt - node.startedAt;
    if (detail) node.detail = { ...node.detail, ...detail };
    this.current = null;
  }

  /** Attach a decision to the current stage node. */
  attachDecision(d: Decision): void {
    if (this.current) this.current.decision = d;
  }

  /** Add a child node (e.g. an event or connector call) to the current stage. */
  addChild(kind: TraceNodeKind, label: string, startedAt: number, detail?: Record<string, unknown>): TraceNode {
    const parent = this.current ?? this.root;
    const child: TraceNode = {
      id: `node_${kind}_${Math.random().toString(36).slice(2, 8)}`,
      parentId: parent.id,
      stage: parent.stage,
      kind,
      label,
      status: 'ok',
      startedAt,
      durationMs: 0,
      detail: detail ?? {},
      children: [],
    };
    parent.children.push(child);
    return child;
  }

  /** Finalize the trace. */
  finalize(status: 'running' | 'completed' | 'failed', finishedAt: number): ExecutionTrace {
    this.root.status = status === 'completed' ? 'ok' : status === 'failed' ? 'error' : 'running';
    this.root.durationMs = finishedAt - this.root.startedAt;
    return {
      intentId: this.intentId,
      correlationId: this.correlationId,
      status,
      root: this.root,
      stages: this.stages,
      startedAt: this.root.startedAt,
      finishedAt,
    };
  }
}
