/**
 * EKG — Parallel DAG Execution Engine.
 *
 * Executes proof trees as parallel DAGs. Independent branches run
 * concurrently via Promise.all. Only sequential dependencies wait.
 *
 *   Verify Identity
 *         │
 *    ┌────┴────┐
 *  Credit    AML     ← these run in parallel
 *    │         │
 *    └────┬────┘
 *    Settlement        ← waits for both
 *         │
 *    Rewards           ← runs after settlement
 */

import { uid } from '@/runtime/types';
import type { Proof, ProofStep } from './types';
import { startSpan, type SpanHandle } from './tracing';

export interface ExecutionNode {
  step: ProofStep;
  children: ExecutionNode[];
  dependencies: ExecutionNode[];  // must complete before this node
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
}

export interface ParallelExecutionResult {
  executionId: string;
  proofId: string;
  status: 'completed' | 'failed';
  nodes: ExecutionNode[];
  totalDurationMs: number;
  parallelBranches: number;
  maxDepth: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * Build a DAG from a proof tree. Identifies which steps can run in parallel
 * (siblings with no inter-dependency).
 */
function buildDAG(step: ProofStep, parent?: ExecutionNode): ExecutionNode {
  const node: ExecutionNode = {
    step,
    children: [],
    dependencies: parent ? [parent] : [],
    status: 'pending',
  };
  for (const child of step.children) {
    node.children.push(buildDAG(child, node));
  }
  return node;
}

/**
 * Flatten the DAG into execution layers. Steps in the same layer can run
 * in parallel. Steps in different layers must run sequentially.
 */
function computeLayers(root: ExecutionNode): ExecutionNode[][] {
  const layers: ExecutionNode[][] = [];
  let current = [root];
  while (current.length > 0) {
    layers.push(current);
    const next: ExecutionNode[] = [];
    for (const node of current) {
      next.push(...node.children);
    }
    current = next;
  }
  return layers;
}

/**
 * Execute a proof as a parallel DAG. Independent branches run concurrently.
 *
 * @param proof The proof to execute
 * @param executeStep Function that executes a single step (capability invocation, etc.)
 * @param traceSpan Optional parent span for tracing
 */
export async function executeParallel(
  proof: Proof,
  executeStep: (step: ProofStep) => Promise<unknown>,
  traceSpan?: SpanHandle,
): Promise<ParallelExecutionResult> {
  const start = Date.now();
  const executionId = uid('pexec');
  const root = buildDAG(proof.root);
  const layers = computeLayers(root);

  let maxDepth = 0;
  let parallelBranches = 0;

  // Execute layer by layer. Within a layer, all nodes run in parallel.
  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    maxDepth = layerIdx + 1;
    if (layer.length > 1) parallelBranches = Math.max(parallelBranches, layer.length);

    // Check if any dependency failed — skip this layer
    const hasFailedDep = layer.some((node) =>
      node.dependencies.some((dep) => dep.status === 'failed'),
    );

    if (hasFailedDep) {
      for (const node of layer) {
        node.status = 'skipped';
      }
      continue;
    }

    // Execute all nodes in this layer in parallel
    const span = traceSpan?.child(`Layer ${layerIdx} (${layer.length} parallel)`, 'settlement', { layer: layerIdx, nodeCount: layer.length });

    await Promise.allSettled(
      layer.map(async (node) => {
        node.status = 'running';
        node.startTime = Date.now();
        try {
          const stepSpan = span?.child(node.step.capabilityName ?? node.step.kind, 'capability', {
            stepKind: node.step.kind,
            capability: node.step.capabilityName,
            entity: node.step.entityName,
          });
          node.result = await executeStep(node.step);
          node.status = 'completed';
          node.endTime = Date.now();
          node.durationMs = node.endTime - node.startTime;
          stepSpan?.end('ok', undefined, { durationMs: node.durationMs });
        } catch (e) {
          node.status = 'failed';
          node.error = e instanceof Error ? e.message : 'Unknown error';
          node.endTime = Date.now();
          node.durationMs = node.endTime - node.startTime;
          span?.end('error', node.error);
        }
      }),
    );

    span?.end();
  }

  // Collect results
  const allNodes = flattenNodes(root);
  const completedCount = allNodes.filter((n) => n.status === 'completed').length;
  const failedCount = allNodes.filter((n) => n.status === 'failed').length;
  const skippedCount = allNodes.filter((n) => n.status === 'skipped').length;

  return {
    executionId,
    proofId: proof.id,
    status: failedCount > 0 ? 'failed' : 'completed',
    nodes: allNodes,
    totalDurationMs: Date.now() - start,
    parallelBranches,
    maxDepth,
    completedCount,
    failedCount,
    skippedCount,
  };
}

function flattenNodes(root: ExecutionNode): ExecutionNode[] {
  const result: ExecutionNode[] = [];
  const walk = (node: ExecutionNode) => {
    result.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return result;
}

/**
 * Get a human-readable execution summary.
 */
export function executionSummary(result: ParallelExecutionResult): string {
  return `Executed ${result.completedCount} steps (${result.parallelBranches} parallel branches, max depth ${result.maxDepth}) in ${result.totalDurationMs}ms. ${result.failedCount} failed, ${result.skippedCount} skipped.`;
}
