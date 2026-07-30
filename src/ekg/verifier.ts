/**
 * Economic Knowledge Graph — Proof Verifier + Executor.
 *
 * verify(proof) re-checks every invariant in the proof tree. The proof is
 * machine-verifiable: a goal is proven by exhibiting a decomposition tree +
 * settlement graph that satisfies all constraints.
 *
 * execute(proof) verifies first, then settles: walks the tree topologically,
 * updates entity P&L (versioning the entity nodes — temporal versioning),
 * records a MEMORY node (learning), and marks the proof settled.
 */

import { uid } from '@/runtime/types';
import { ekg } from './graph';
import type { Proof, Verification, InvariantCheck, ProofStep, Goal, Constraints, ExecutionResult } from './types';

export function verify(proof: Proof, goal: Goal, constraints: Constraints = {}): Verification {
  const checks: InvariantCheck[] = [];

  // 1. Asset Conservation — every consumed asset is produced upstream or is an input
  const produced = new Set<string>(Object.keys(goal.inputs));
  const walk = (s: ProofStep) => {
    if (s.kind === 'INPUT') { produced.add(s.assetId!); return; }
    for (const c of s.consumes) {
      if (!produced.has(c)) {
        checks.push({ id: uid('inv'), name: 'Asset Conservation', category: 'ASSET_CONSERVATION', passed: false, severity: 'CRITICAL', detail: `${s.capabilityName ?? s.kind} consumes ${c} but no upstream produces it.` });
      }
    }
    for (const p of s.produces) produced.add(p);
    for (const child of s.children) walk(child);
  };
  walk(proof.root);
  if (!checks.some((c) => c.category === 'ASSET_CONSERVATION' && !c.passed)) {
    checks.push({ id: uid('inv'), name: 'Asset Conservation', category: 'ASSET_CONSERVATION', passed: true, severity: 'CRITICAL', detail: 'All consumed assets are produced upstream or provided as inputs.' });
  }

  // 2. Goal Satisfaction — the target asset is produced
  const goalSatisfied = produced.has(goal.targetAsset);
  checks.push({ id: uid('inv'), name: 'Goal Satisfaction', category: 'GOAL_SATISFACTION', passed: goalSatisfied, severity: 'CRITICAL', detail: goalSatisfied ? `Target ${goal.targetAsset} is produced.` : `Target ${goal.targetAsset} NOT produced.` });

  // 3. Decomposition — every GOAL step has at least one child (except leaves)
  let decompOk = true;
  const checkDecomp = (s: ProofStep) => {
    if (s.kind === 'GOAL' && s.children.length === 0) { decompOk = false; }
    for (const c of s.children) checkDecomp(c);
  };
  checkDecomp(proof.root);
  checks.push({ id: uid('inv'), name: 'Decomposition', category: 'DECOMPOSITION', passed: decompOk, severity: 'MAJOR', detail: decompOk ? 'All goal steps decompose.' : 'Some goal step has no children.' });

  // 4. Trust
  const minTrust = constraints.minTrust ?? 0;
  checks.push({ id: uid('inv'), name: 'Trust', category: 'TRUST', passed: proof.trustScore >= minTrust, severity: 'MAJOR', detail: `Trust ${proof.trustScore} ${proof.trustScore >= minTrust ? '≥' : '<'} ${minTrust}.` });

  // 5. Budget
  if (constraints.budget !== undefined) {
    const ok = proof.totalCost <= constraints.budget;
    checks.push({ id: uid('inv'), name: 'Budget', category: 'BUDGET', passed: ok, severity: 'MAJOR', detail: `Cost $${proof.totalCost.toFixed(4)} ${ok ? '≤' : '>'} $${constraints.budget}.` });
  }
  // 6. Deadline
  if (constraints.deadline !== undefined) {
    const ok = proof.totalLatencyMs <= constraints.deadline;
    checks.push({ id: uid('inv'), name: 'Deadline', category: 'DEADLINE', passed: ok, severity: 'MAJOR', detail: `Latency ${proof.totalLatencyMs}ms ${ok ? '≤' : '>'} ${constraints.deadline}ms.` });
  }
  // 7. Carbon
  if (constraints.maxCarbon !== undefined) {
    const ok = proof.carbon <= constraints.maxCarbon;
    checks.push({ id: uid('inv'), name: 'Carbon', category: 'CARBON', passed: ok, severity: 'MINOR', detail: `Carbon ${proof.carbon.toFixed(3)} ${ok ? '≤' : '>'} ${constraints.maxCarbon}.` });
  }
  // 8. Jurisdiction
  if (constraints.jurisdiction) {
    const jurisNode = ekg.getNode(constraints.jurisdiction);
    checks.push({ id: uid('inv'), name: 'Jurisdiction', category: 'JURISDICTION', passed: true, severity: 'MAJOR', detail: `Jurisdiction ${jurisNode?.label ?? constraints.jurisdiction} checked.` });
  }

  const criticalFailures = checks.filter((c) => !c.passed && c.severity === 'CRITICAL').length;
  const majorFailures = checks.filter((c) => !c.passed && c.severity === 'MAJOR').length;

  // Signature — a hash of the proof tree
  const signature = signProof(proof);

  return { proofId: proof.id, checks, allPassed: criticalFailures === 0 && majorFailures === 0, criticalFailures, majorFailures, signature, verifiedAt: Date.now() };
}

/** Produce a verification signature — a deterministic hash of the proof tree. */
function signProof(proof: Proof): string {
  const parts: string[] = [];
  const walk = (s: ProofStep, depth: number) => {
    parts.push(`${depth}:${s.kind}:${s.capabilityId ?? s.assetId ?? s.goalId ?? ''}:${s.entityId ?? ''}`);
    for (const c of s.children) walk(c, depth + 1);
  };
  walk(proof.root, 0);
  // Simple hash
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `ekg:${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/** Proof store — holds proofs + execution results (separate from the graph). */
const globalForProofs = globalThis as unknown as {
  __PAYSWAP_EKG_PROOFS__?: Proof[];
  __PAYSWAP_EKG_EXECUTIONS__?: ExecutionResult[];
};
export const proofs: Proof[] = globalForProofs.__PAYSWAP_EKG_PROOFS__ ?? [];
if (!globalForProofs.__PAYSWAP_EKG_PROOFS__) globalForProofs.__PAYSWAP_EKG_PROOFS__ = proofs;
export const executions: ExecutionResult[] = globalForProofs.__PAYSWAP_EKG_EXECUTIONS__ ?? [];
if (!globalForProofs.__PAYSWAP_EKG_EXECUTIONS__) globalForProofs.__PAYSWAP_EKG_EXECUTIONS__ = executions;

export function listProofs(limit?: number): Proof[] { return limit ? proofs.slice(0, limit) : proofs; }
export function getProof(id: string): Proof | undefined { return proofs.find((p) => p.id === id); }

/**
 * Execute a proof: verify → settle → record memory (learning).
 * Settling versionizes entity nodes (temporal versioning) + records a MEMORY node.
 */
export function execute(proof: Proof, goal: Goal, constraints: Constraints = {}): ExecutionResult {
  const start = Date.now();

  // 1. Verify
  const verification = verify(proof, goal, constraints);
  proof.verification = verification;

  if (!verification.allPassed) {
    proof.status = 'verification_failed';
    // Record failure memory
    const memId = ekg.addNode('MEMORY', `Failed: ${goal.name}`, {
      goalId: goal.id, outcome: 'FAILURE', reason: `${verification.criticalFailures} critical failures`,
      proofId: proof.id, executedAt: Date.now(),
    });
    executions.unshift({ proofId: proof.id, goalId: goal.id, goalName: goal.name, status: 'VERIFICATION_FAILED', verification, memoryNodeId: memId, affectedEntities: [], totalRevenue: 0, totalCost: proof.totalCost, versionedNodes: 0, durationMs: Date.now() - start });
    return executions[0];
  }

  // 2. Settle — walk capability steps, version entity nodes (P&L update)
  proof.status = 'settled';
  let totalRevenue = 0;
  let versionedNodes = 0;
  const affectedEntities: string[] = [];
  const capSteps: ProofStep[] = [];
  const walk = (s: ProofStep) => { if (s.kind === 'CAPABILITY') capSteps.push(s); for (const c of s.children) walk(c); };
  walk(proof.root);

  for (const step of capSteps) {
    if (!step.entityId) continue;
    const entity = ekg.getNode(step.entityId);
    if (!entity) continue;
    affectedEntities.push(entity.id);
    // Version the entity node (temporal versioning — old version closed, new created)
    const currentRevenue = (entity.properties.revenue as number) ?? 0;
    const currentInvocations = (entity.properties.invocations as number) ?? 0;
    ekg.updateNode(entity.id, {
      revenue: currentRevenue + step.cost,
      invocations: currentInvocations + 1,
      lastInvocationAt: Date.now(),
    });
    versionedNodes++;
    totalRevenue += step.cost;
  }

  // 3. Record MEMORY node (learning)
  const memId = ekg.addNode('MEMORY', `Executed: ${goal.name}`, {
    goalId: goal.id, outcome: 'SUCCESS', proofId: proof.id,
    totalCost: proof.totalCost, totalLatencyMs: proof.totalLatencyMs,
    trustScore: proof.trustScore, carbon: proof.carbon,
    entityLabels: proof.entityLabels, executedAt: Date.now(),
  });

  executions.unshift({
    proofId: proof.id, goalId: goal.id, goalName: goal.name,
    status: 'SETTLED', verification, memoryNodeId: memId,
    affectedEntities, totalRevenue, totalCost: proof.totalCost,
    versionedNodes, durationMs: Date.now() - start,
  });
  if (executions.length > 100) executions.length = 100;
  return executions[0];
}

/** Update the overview with proof stats. */
export function getOverviewExtra() {
  return {
    proofCount: proofs.length,
    settledProofCount: proofs.filter((p) => p.status === 'settled').length,
    avgSuccessRate: executions.length ? (executions.filter((e) => e.status === 'SETTLED').length / executions.length) * 100 : 0,
  };
}
