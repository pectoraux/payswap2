/**
 * Invariant Registry — holds all registered invariants. (M-RT-20.)
 *
 * The registry is insertion-ordered. The engine iterates invariants in
 * registration order (deterministic).
 */

import type { RuntimeInvariant, InvariantHealth, Violation } from './types';

/** Tracks the last result + violation history for one invariant. */
interface InvariantState {
  invariant: RuntimeInvariant;
  lastResult: { passed: boolean; verifiedAt: number; violationCount: number } | null;
  recentViolations: Violation[];
}

const MAX_RECENT_VIOLATIONS = 10;

export class InvariantRegistry {
  private readonly states: Map<string, InvariantState> = new Map();
  private readonly order: string[] = [];

  /** Register an invariant. Overwrites if already registered. */
  register(invariant: RuntimeInvariant): void {
    if (!this.states.has(invariant.id)) {
      this.order.push(invariant.id);
    }
    this.states.set(invariant.id, {
      invariant,
      lastResult: null,
      recentViolations: [],
    });
  }

  /** Get all registered invariants (insertion order). */
  all(): RuntimeInvariant[] {
    return this.order.map((id) => this.states.get(id)!.invariant);
  }

  /** Get one invariant by ID. */
  get(id: string): RuntimeInvariant | null {
    return this.states.get(id)?.invariant ?? null;
  }

  /** Record a verification result (called by the engine after each run). */
  recordResult(
    invariantId: string,
    result: { passed: boolean; verifiedAt: number; violations: Violation[] },
  ): void {
    const state = this.states.get(invariantId);
    if (!state) return;
    state.lastResult = {
      passed: result.passed,
      verifiedAt: result.verifiedAt,
      violationCount: result.violations.length,
    };
    // Append new violations to recent history (capped).
    if (result.violations.length > 0) {
      state.recentViolations = [...state.recentViolations, ...result.violations].slice(-MAX_RECENT_VIOLATIONS);
    }
  }

  /** Get health for one invariant. */
  health(invariantId: string): InvariantHealth | null {
    const state = this.states.get(invariantId);
    if (!state) return null;
    return {
      id: state.invariant.id,
      description: state.invariant.description,
      healthy: state.lastResult?.passed ?? false,
      lastRun: state.lastResult?.verifiedAt ?? null,
      violationCount: state.lastResult?.violationCount ?? 0,
      recentViolations: state.recentViolations,
    };
  }

  /** Get health for ALL invariants. */
  allHealth(): InvariantHealth[] {
    return this.order.map((id) => this.health(id)!).filter(Boolean);
  }

  /** List of registered invariant IDs. */
  ids(): string[] {
    return [...this.order];
  }

  /** Clear all state (for testing). */
  clear(): void {
    this.states.clear();
    this.order.length = 0;
  }
}
