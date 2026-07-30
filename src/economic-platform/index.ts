/**
 * Economic Computation Platform — public entry point.
 *
 * The universal resolve() — capabilities are the primitive, everything else
 * is emergent. The graph is the only data structure.
 *
 *   import { resolveGoal, executeProof, platform } from '@/economic-platform';
 *   const proof = resolveGoal(goal, constraints);
 *   const result = executeProof(proof, goal, constraints);
 *   // → learning loop updates provider scores → next resolve() is better
 */
export * from './types';
export * from './store';
export * from './planner';
export * from './verifier';
export * from './executor';
