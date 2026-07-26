/**
 * PaySwap Runtime — public entry point. (Principle 1: Runtime First.)
 *
 * The Runtime is the product. Every client (Dashboard, Admin, Twin, SDK,
 * CLI, Extensions, AI Agents, Mobile, API) enters through `dispatch()`.
 *
 * M-RT-1 ships the skeleton: a working RuntimeClock (live 1×), an in-memory
 * EventStore with OCC, an IntentEngine with overridable hooks, a 14-stage
 * Pipeline scaffold with no-op handlers, and the Decision/Policy/Inspector
 * interfaces. Dispatching any intent flows through all stages, appends real
 * events, and produces a real trace — with zero business logic.
 *
 * The existing app is untouched. M-RT-2 wires real payment logic into the
 * stages and connects the first vertical slice to the UI.
 */

import { LiveClock, VirtualClock, type RuntimeClock } from './clock';
import { InMemoryEventStore, type EventStore } from './events';
import { IntentEngine } from './intent';
import { Pipeline } from './pipeline';
import { DefaultPolicyEngine, type PolicyEngine } from './policy';
import { ProjectionRunner } from './read-models';

// Re-export the public surface.
export * from './types';
export * from './principles';
export * from './vocabulary';
export * from './clock';
export * from './events';
export * from './decisions';
export * from './intent';
export * from './policy';
export * from './pipeline';
export * from './inspector';
export * from './read-models';

import type { MerchantIntent, TypedIntent } from './intent';
import type { ExecutionResult, StageHandler, PipelineStageId } from './pipeline';
import type { Environment, IntentSource, Actor, RequestContext } from './types';
import { requestContext } from './intent';

/** The Runtime container — holds every component and exposes dispatch. */
export interface Runtime {
  clock: RuntimeClock;
  eventStore: EventStore;
  intentEngine: IntentEngine;
  pipeline: Pipeline;
  policyEngine: PolicyEngine;
  projectionRunner: ProjectionRunner;

  /** Dispatch a raw merchant intent through the full pipeline. */
  dispatch(raw: MerchantIntent, ctx: RequestContext): Promise<ExecutionResult>;

  /** Register an execution-stage handler (M-RT-2+ uses this). */
  registerStage(stage: PipelineStageId, handler: StageHandler): void;

  /** Register intent hooks for a kind (M-RT-2+ uses this). */
  registerIntent(kind: string, hooks: import('./intent').IntentHooks): void;
}

export interface CreateRuntimeOptions {
  environment?: Environment;
  /** Use a virtual clock (sandbox/twin). Default: live clock. */
  virtualClock?: { origin?: number; speed?: number };
  /** Provide a custom EventStore (e.g. Prisma-backed in M-RT-2). */
  eventStore?: EventStore;
}

/** Create a Runtime instance. */
export function createRuntime(opts: CreateRuntimeOptions = {}): Runtime {
  const clock: RuntimeClock = opts.virtualClock
    ? new VirtualClock(opts.virtualClock)
    : new LiveClock();
  const eventStore: EventStore = opts.eventStore ?? new InMemoryEventStore();
  const intentEngine = new IntentEngine(clock);
  const policyEngine = new DefaultPolicyEngine();
  const pipeline = new Pipeline(clock, intentEngine, eventStore, policyEngine);
  const projectionRunner = new ProjectionRunner();
  projectionRunner.start(eventStore);

  const runtime: Runtime = {
    clock,
    eventStore,
    intentEngine,
    pipeline,
    policyEngine,
    projectionRunner,
    dispatch: (raw, ctx) => pipeline.dispatch(raw, ctx),
    registerStage: (stage, handler) => pipeline.register(stage, handler),
    registerIntent: (kind, hooks) => intentEngine.register(kind, hooks),
  };
  return runtime;
}

/**
 * The default Runtime singleton (live environment, in-memory store).
 *
 * Uses globalThis so Next.js dev-mode module re-instantiation doesn't
 * create duplicate runtimes (same pattern as the existing eventBus/db).
 */
const globalForRuntime = globalThis as unknown as { __PAYSWAP_RUNTIME__?: Runtime };
export const runtime: Runtime =
  globalForRuntime.__PAYSWAP_RUNTIME__ ?? createRuntime();
if (!globalForRuntime.__PAYSWAP_RUNTIME__) {
  globalForRuntime.__PAYSWAP_RUNTIME__ = runtime;
}

/**
 * Convenience: dispatch a raw intent on the default runtime.
 *
 * @example
 *   const result = await dispatch(
 *     { kind: 'payment', raw: { customer: 'Alice', amount: 120, currency: 'USD' } },
 *     { actor: { id: 'usr_1', role: 'merchant' }, environment: 'sandbox', source: 'dashboard' },
 *   );
 */
export function dispatch(
  raw: MerchantIntent,
  ctx: {
    actor: Actor;
    environment: Environment;
    source: IntentSource;
    correlationId?: string;
    causationId?: string;
  },
): Promise<ExecutionResult> {
  return runtime.dispatch(raw, requestContext(ctx));
}

/** Re-export key types for callers. */
export type { MerchantIntent, TypedIntent, ExecutionResult, RuntimeClock, EventStore, PolicyEngine };
