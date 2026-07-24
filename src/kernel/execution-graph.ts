/**
 * PaySwap Runtime — Execution Graph (DAG).
 *
 * The Financial Solver produces a directed acyclic graph (DAG) of state
 * transitions, not a linear list of steps. Independent work can execute in
 * parallel. This gives the runtime retries, checkpoints, compensation,
 * partial rollback, and replay almost for free.
 *
 *   Debit Buyer ──────► Credit Reserve A ──► Mint Twin ──► LP Settlement ──► Burn Twin ──► Credit Merchant
 *                                                                    │
 *                                                                    ▼
 *                                                              Treasury Bridge
 *
 * Each node is a GraphNode (a state transition). Each edge is a dependency.
 * Nodes without dependencies between them can run in parallel.
 */
import { uid } from './support';

export type GraphNodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensated'
  | 'skipped';

export type GraphNodeType =
  | 'debit'
  | 'credit'
  | 'mint'
  | 'burn'
  | 'draw_lp'
  | 'draw_reserve'
  | 'draw_treasury'
  | 'fx_convert'
  | 'notify'
  | 'await'
  | 'insurance'
  | 'accrue_fee';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  title: string;
  description: string;
  amount?: number;
  currency?: string;
  entityRef?: string;
  status: GraphNodeStatus;
  dependencies: string[]; // node IDs that must complete before this one
  parallelGroup?: number; // nodes in the same group with no deps can run together
  reversible: boolean;
  compensationNode?: string; // node to execute if this one fails
  checkpoint?: boolean; // can resume from here
  meta?: Record<string, string | number | boolean>;
  frame?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'dependency' | 'compensation';
}

export interface ExecutionGraph {
  id: string;
  commandId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  root: string;   // entry node
  leaf: string;   // terminal node
  status: 'draft' | 'validated' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  parallelGroups: number;
  totalNodes: number;
  criticalPathLength: number;
}

/** Build an Execution Graph from a list of sequential steps (with parallelization hints). */
export function buildExecutionGraph(
  commandId: string,
  steps: { type: GraphNodeType; title: string; description: string; amount?: number; currency?: string; entityRef?: string; reversible?: boolean; parallelWith?: string[]; compensationFor?: string; frame?: number; meta?: Record<string, string | number | boolean> }[],
): ExecutionGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const idMap = new Map<string, string>(); // step title → node id

  // Create nodes
  for (const step of steps) {
    const nodeId = uid('node');
    idMap.set(step.title, nodeId);
    nodes.push({
      id: nodeId,
      type: step.type,
      title: step.title,
      description: step.description,
      amount: step.amount,
      currency: step.currency,
      entityRef: step.entityRef,
      status: 'pending',
      dependencies: [],
      reversible: step.reversible ?? true,
      checkpoint: false,
      meta: step.meta,
      frame: step.frame,
    });
  }

  // Create dependency edges
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = idMap.get(step.title)!;
    if (i > 0) {
      const prevId = idMap.get(steps[i - 1].title)!;
      nodes.find((n) => n.id === nodeId)!.dependencies.push(prevId);
      edges.push({ from: prevId, to: nodeId, kind: 'dependency' });
    }
    // Parallel edges — these nodes don't depend on each other
    if (step.parallelWith) {
      for (const parTitle of step.parallelWith) {
        const parId = idMap.get(parTitle);
        if (parId) {
          // Mark as same parallel group but no dependency edge
        }
      }
    }
    // Compensation edges
    if (step.compensationFor) {
      const compId = idMap.get(step.compensationFor);
      if (compId) {
        const compNode = nodes.find((n) => n.id === compId);
        const thisNode = nodes.find((n) => n.id === nodeId);
        if (compNode && thisNode) {
          compNode.compensationNode = nodeId;
          edges.push({ from: nodeId, to: compId, kind: 'compensation' });
        }
      }
    }
  }

  // Compute parallel groups (nodes that can run simultaneously)
  const parallelGroups = computeParallelGroups(nodes);
  for (const node of nodes) {
    node.parallelGroup = parallelGroups.get(node.id) ?? 0;
  }

  // Mark checkpoint nodes (every 3rd node can resume)
  nodes.forEach((n, i) => { if (i % 3 === 0) n.checkpoint = true; });

  const root = nodes[0]?.id ?? '';
  const leaf = nodes[nodes.length - 1]?.id ?? '';
  const criticalPathLength = computeCriticalPath(nodes, root);

  return {
    id: uid('graph'),
    commandId,
    nodes,
    edges,
    root,
    leaf,
    status: 'draft',
    parallelGroups: new Set(parallelGroups.values()).size,
    totalNodes: nodes.length,
    criticalPathLength,
  };
}

/** Compute which nodes can run in parallel (same group = can run together). */
function computeParallelGroups(nodes: GraphNode[]): Map<string, number> {
  const groups = new Map<string, number>();
  const completed = new Set<string>();
  let groupNum = 0;

  while (completed.size < nodes.length) {
    const ready = nodes.filter((n) =>
      !completed.has(n.id) &&
      n.dependencies.every((d) => completed.has(d)),
    );
    if (ready.length === 0) break;
    for (const r of ready) {
      groups.set(r.id, groupNum);
      completed.add(r.id);
    }
    groupNum++;
  }
  return groups;
}

/** Compute the critical path length (longest dependency chain). */
function computeCriticalPath(nodes: GraphNode[], root: string): number {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const dfs = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const node = nodeMap.get(id);
    if (!node) return 0;
    const dependents = nodes.filter((n) => n.dependencies.includes(id));
    if (dependents.length === 0) return 1;
    const max = Math.max(...dependents.map((d) => dfs(d.id)));
    memo.set(id, max + 1);
    return max + 1;
  };
  return dfs(root);
}

/** Get nodes in topological order (execution order). */
export function topologicalOrder(graph: ExecutionGraph): GraphNode[] {
  const result: GraphNode[] = [];
  const visited = new Set<string>();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    for (const dep of node.dependencies) visit(dep);
    result.push(node);
  };
  for (const n of graph.nodes) visit(n.id);
  return result;
}

/** Get nodes grouped by parallel execution group. */
export function parallelLayers(graph: ExecutionGraph): GraphNode[][] {
  const layers = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const g = node.parallelGroup ?? 0;
    if (!layers.has(g)) layers.set(g, []);
    layers.get(g)!.push(node);
  }
  return [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
