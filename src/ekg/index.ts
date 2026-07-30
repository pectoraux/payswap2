/**
 * Economic Knowledge Graph (EKG) — public entry point.
 *
 * THE FOUNDATION. Everything is a node in a unified typed property graph.
 * prove(goal) is graph theorem proving. Every node is temporally versioned.
 * The proof language is machine-verifiable.
 *
 *   import { prove, simulate, execute, verify, ekg, getGoals } from '@/ekg';
 *   const goals = getGoals();
 *   const proofs = prove(goals[0], goals[0].constraints ?? {});
 *   const sim = simulate(proofs[0]);
 *   const result = execute(proofs[0], goals[0]);
 *   const isVerified = verify(proofs[0], goals[0]).allPassed;
 */
export * from './types';
export * from './graph';
export * from './planner';
export * from './scorer';
export * from './simulator';
export * from './verifier';
export * from './seed';
export * from './inspector';
export * from './event-log';
export * from './formal-verifier';
export * from './dsl';
export * from './operability';
export * from './adapters';
