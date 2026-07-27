/**
 * Runtime Host — owns Sandbox + Live runtimes. (M-RT-29, Dual Runtime.)
 *
 *   RuntimeHost
 *   ├── Sandbox Runtime (completely isolated: own EventStore, Treasury, LPs, etc.)
 *   └── Live Runtime   (completely isolated: own EventStore, Treasury, LPs, etc.)
 *
 * Nothing is shared except immutable configuration (code, adapters, schema types).
 * Events, projections, treasury, marketplace, LPs, recovery, checkpoints — all isolated.
 *
 *   sandbox/* events NEVER mix with live/* events.
 *   Sandbox treasury NEVER leaks to Live treasury.
 *   Sandbox LP offers NEVER appear in Live routing.
 *
 * The host routes incoming commands to the correct runtime based on
 * `command.metadata.environment`.
 */

import { createRuntime, type Runtime, type CreateRuntimeOptions } from '../index';
import type { RuntimeCommand } from '../dispatcher/types';
import type { Environment } from '../types';
import type { TransactionResult } from '../transaction';

/** A runtime context — one per environment. */
export interface RuntimeContext {
  /** Runtime ID (e.g., "sandbox", "live"). */
  runtimeId: string;
  /** Environment. */
  environment: Environment;
  /** The runtime instance (completely isolated). */
  runtime: Runtime;
}

/**
 * RuntimeHost — owns Sandbox + Live runtimes.
 *
 *   const host = new RuntimeHost();
 *   const sandbox = host.get('sandbox');
 *   const live = host.get('live');
 *
 *   // Execute a command in sandbox.
 *   const result = await host.execute(command);
 *   // → routes to sandbox or live based on command.metadata.environment
 */
export class RuntimeHost {
  private readonly contexts = new Map<Environment, RuntimeContext>();
  private activeEnvironment: Environment = 'sandbox';

  constructor(opts?: { sandbox?: CreateRuntimeOptions; live?: CreateRuntimeOptions }) {
    // Create two completely independent runtime instances.
    const sandboxRuntime = createRuntime({ environment: 'sandbox', ...opts?.sandbox });
    const liveRuntime = createRuntime({ environment: 'live', ...opts?.live });

    this.contexts.set('sandbox', {
      runtimeId: 'sandbox',
      environment: 'sandbox',
      runtime: sandboxRuntime,
    });

    this.contexts.set('live', {
      runtimeId: 'live',
      environment: 'live',
      runtime: liveRuntime,
    });
  }

  /** Get a runtime context by environment. */
  get(environment: Environment): RuntimeContext | null {
    return this.contexts.get(environment) ?? null;
  }

  /** Get the runtime instance by environment. */
  getRuntime(environment: Environment): Runtime | null {
    return this.contexts.get(environment)?.runtime ?? null;
  }

  /** Get the active runtime (based on the active environment). */
  getActiveRuntime(): Runtime {
    return this.contexts.get(this.activeEnvironment)!.runtime;
  }

  /** Get the active environment. */
  getActiveEnvironment(): Environment {
    return this.activeEnvironment;
  }

  /** Switch the active environment (no restart required). */
  switchEnvironment(environment: Environment): void {
    if (!this.contexts.has(environment)) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    this.activeEnvironment = environment;
  }

  /**
   * Execute a command — routes to the correct runtime based on
   * command.metadata.environment.
   */
  async execute(command: RuntimeCommand): Promise<TransactionResult> {
    const env = command.metadata.environment;
    const ctx = this.contexts.get(env);
    if (!ctx) {
      throw new Error(`No runtime for environment: ${env}`);
    }
    return ctx.runtime.coordinator.execute(command);
  }

  /** Execute nested commands — routes to the correct runtime. */
  async executeNested(commands: RuntimeCommand[], metadata: RuntimeCommand['metadata']): Promise<TransactionResult> {
    const env = metadata.environment;
    const ctx = this.contexts.get(env);
    if (!ctx) {
      throw new Error(`No runtime for environment: ${env}`);
    }
    return ctx.runtime.coordinator.executeNested(commands, metadata);
  }

  /** Get all runtime contexts. */
  getAll(): RuntimeContext[] {
    return [...this.contexts.values()];
  }

  /** Check if an environment is available. */
  has(environment: Environment): boolean {
    return this.contexts.has(environment);
  }

  /**
   * Verify isolation: ensure sandbox and live don't share any mutable state.
   *
   * Checks:
   *   - Different EventStore instances
   *   - Different projection instances
   *   - Different treasury instances
   *   - Different marketplace instances
   *   - Different LP runtime instances
   */
  verifyIsolation(): { isolated: boolean; checks: { name: string; isolated: boolean }[] } {
    const sandbox = this.contexts.get('sandbox')!.runtime;
    const live = this.contexts.get('live')!.runtime;

    const checks = [
      { name: 'eventStore', isolated: sandbox.eventStore !== live.eventStore },
      { name: 'payments', isolated: sandbox.payments !== live.payments },
      { name: 'refunds', isolated: sandbox.refunds !== live.refunds },
      { name: 'wallets', isolated: sandbox.wallets !== live.wallets },
      { name: 'treasury', isolated: sandbox.treasury !== live.treasury },
      { name: 'twinTokens', isolated: sandbox.twinTokens !== live.twinTokens },
      { name: 'lpRuntime', isolated: sandbox.lpRuntime !== live.lpRuntime },
      { name: 'marketplace', isolated: sandbox.marketplace !== live.marketplace },
      { name: 'economicCompiler', isolated: sandbox.economicCompiler !== live.economicCompiler },
      { name: 'coordinator', isolated: sandbox.coordinator !== live.coordinator },
      { name: 'schema', isolated: sandbox.schema !== live.schema },
      { name: 'recovery', isolated: sandbox.recovery !== live.recovery },
      { name: 'invariants', isolated: sandbox.invariants !== live.invariants },
      { name: 'dispatcher', isolated: sandbox.dispatcher !== live.dispatcher },
    ];

    return {
      isolated: checks.every((c) => c.isolated),
      checks,
    };
  }

  /** Get a dual-runtime report (for the inspector). */
  getReport(): {
    activeEnvironment: Environment;
    runtimes: {
      environment: Environment;
      eventCount: number;
      projectionCount: number;
      treasuryAccounts: number;
      lpCount: number;
      twinTokenPositions: number;
    }[];
    isolation: { isolated: boolean; checks: { name: string; isolated: boolean }[] };
  } {
    const runtimes = this.getAll().map((ctx) => ({
      environment: ctx.environment,
      eventCount: ctx.runtime.eventStore.size(),
      projectionCount: 4, // payments + refunds + wallets + treasury
      treasuryAccounts: ctx.runtime.treasury.projection.count(),
      lpCount: ctx.runtime.lpRuntime.count(),
      twinTokenPositions: ctx.runtime.twinTokens.count(),
    }));

    return {
      activeEnvironment: this.activeEnvironment,
      runtimes,
      isolation: this.verifyIsolation(),
    };
  }
}
