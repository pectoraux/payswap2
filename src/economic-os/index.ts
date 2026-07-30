/**
 * Economic Operating System — public entry point.
 *
 * Re-exports the store, compiler, optimizer, and settlement kernel so API
 * routes and pages can consume them via `@/economic-os`.
 *
 * Usage:
 *   import { economicOS, compileIntent, settleGraph } from '@/economic-os';
 *   const graph = compileIntent(economicOS.getIntent('intent-pay-tuition')!);
 *   const exec  = settleGraph(graph);
 */
export * from './types';
export * from './store';
export * from './compiler';
export * from './optimizer';
export * from './settlement';
