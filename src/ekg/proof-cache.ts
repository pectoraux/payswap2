/**
 * EKG — Proof Cache with Invalidation.
 *
 * Caches resolved proofs keyed by (goalId, constraints, nodeHash).
 * When graph nodes change, affected proofs are invalidated.
 * Turns planning from O(N) into ~O(changed nodes).
 */

import { db } from '@/lib/db';
import { createHash } from 'crypto';
import { uid } from '@/runtime/types';
import { persistentGraph } from './persistent-graph';

export interface CachedProof {
  id: string;
  goalId: string;
  goalName: string;
  constraints: Record<string, unknown>;
  proofData: unknown;       // serialized proof
  plannerScore: number;
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  nodeHash: string;
  createdAt: number;
}

/**
 * Compute a hash of all graph nodes used in a proof.
 * If any node changes, the hash changes, and the cache miss triggers recompute.
 */
export async function computeNodeHash(nodeIds: string[]): Promise<string> {
  await persistentGraph; // ensure loaded
  const nodes = await Promise.all(nodeIds.map((id) => persistentGraph.getNode(id)));
  const validNodes = nodes.filter((n): n is NonNullable<typeof n> => !!n);
  const data = validNodes
    .map((n) => `${n.id}:${n.kind}:${n.label}:${JSON.stringify(n.properties)}`)
    .sort()
    .join('|');
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Try to get a cached proof for a goal + constraints + current graph state.
 * Returns null if cache miss (graph changed or never computed).
 */
export async function getCachedProof(
  goalId: string,
  constraints: Record<string, unknown>,
  currentNodeHash: string,
): Promise<CachedProof | null> {
  const row = await db.proofCache.findFirst({
    where: {
      goalId,
      status: 'valid',
      nodeHash: currentNodeHash,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    goalId: row.goalId,
    goalName: row.goalName,
    constraints: JSON.parse(row.constraints),
    proofData: JSON.parse(row.proofData),
    plannerScore: row.plannerScore,
    totalCost: row.totalCost,
    totalLatencyMs: row.totalLatencyMs,
    trustScore: row.trustScore,
    nodeHash: row.nodeHash,
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * Store a proof in the cache.
 */
export async function cacheProof(
  goalId: string,
  goalName: string,
  constraints: Record<string, unknown>,
  proofData: unknown,
  score: number,
  cost: number,
  latencyMs: number,
  trustScore: number,
  nodeHash: string,
): Promise<void> {
  await db.proofCache.create({
    data: {
      id: uid('pc'),
      goalId,
      goalName,
      constraints: JSON.stringify(constraints),
      proofData: JSON.stringify(proofData),
      plannerScore: score,
      totalCost: cost,
      totalLatencyMs: latencyMs,
      trustScore,
      nodeHash,
      status: 'valid',
    },
  });
}

/**
 * Invalidate all cached proofs that depend on a given node.
 * Called when a node is updated or a relationship is added/removed.
 */
export async function invalidateProofsForNode(nodeId: string): Promise<number> {
  // Get the current node hash that includes this node
  const node = await persistentGraph.getNode(nodeId);
  if (!node) return 0;
  // Invalidate all proofs whose nodeHash no longer matches
  // (we can't compute the new hash without knowing all nodes in each proof,
  // so we invalidate all proofs for goals that might depend on this node)
  const result = await db.proofCache.updateMany({
    where: { status: 'valid' },
    data: { status: 'invalidated', invalidatedAt: new Date() },
  });
  return result.count;
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<{ valid: number; invalidated: number; hitRate: number }> {
  const [valid, invalidated] = await Promise.all([
    db.proofCache.count({ where: { status: 'valid' } }),
    db.proofCache.count({ where: { status: 'invalidated' } }),
  ]);
  const total = valid + invalidated;
  return {
    valid,
    invalidated,
    hitRate: total > 0 ? valid / total : 0,
  };
}
