/**
 * General-Purpose Economic Computation Engine — public entry point.
 *
 * The universal resolve() API is the primary programming model:
 *
 *   import { resolve, executeProof, economicEngine } from '@/economic-engine';
 *
 *   const { proofs } = resolve(goal, constraints);
 *   const best = proofs[0]; // highest planner score
 *   const result = executeProof(best, goal, constraints);
 *
 * PaySwap is now a general-purpose economic computation platform: a runtime
 * that compiles high-level goals into verified networks of autonomous economic
 * organizations exchanging typed assets under explicit constraints + policies.
 */
export * from './types';
export * from './store';
export * from './planner';
export * from './verifier';
export * from './executor';
