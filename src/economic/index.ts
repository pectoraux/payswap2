/**
 * Economic Composition Engine — public entry point.
 *
 * Re-exports the in-memory store, service, pipeline engine, and graph builder
 * so API routes and pages can consume them via `@/economic`.
 *
 * Usage:
 *   import { economicEngine } from '@/economic';
 *   const tokens = economicEngine.listTokens();
 *   const graph  = economicEngine.buildGraph();
 *   const exec   = economicEngine.triggerPipeline(id, payload);
 */
export * from './types';
export * from './store';
export * from './pipeline-engine';
export * from './graph';
