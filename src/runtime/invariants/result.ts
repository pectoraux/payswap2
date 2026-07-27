/**
 * Invariant Result helpers. (M-RT-20, Economic Integrity Hardening.)
 *
 * Pure functions for building InvariantVerificationResult objects. Invariants use
 * these to return pass/fail without boilerplate.
 */

import type { InvariantVerificationResult, Violation, RuntimeSnapshot, StoredEvent } from './types';

/** Build a "passed" result (no violations). */
export function pass(
  invariantId: string,
  startedAt: number,
): InvariantVerificationResult {
  return {
    invariantId,
    passed: true,
    violations: [],
    verifiedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };
}

/** Build a "failed" result with one or more violations. */
export function fail(
  invariantId: string,
  violations: Violation[],
  startedAt: number,
): InvariantVerificationResult {
  return {
    invariantId,
    passed: false,
    violations,
    verifiedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };
}

/** Build a single violation with provenance. */
export function violation(
  invariantId: string,
  message: string,
  opts: {
    event?: StoredEvent;
    projection?: { name: string; id: string };
    command?: { intentId: string; correlationId: string };
    severity?: 'error' | 'warning';
  } = {},
): Violation {
  return {
    invariantId,
    message,
    event: opts.event
      ? { type: opts.event.type, streamId: opts.event.streamId, globalPosition: opts.event.globalPosition }
      : undefined,
    projection: opts.projection,
    command: opts.command,
    severity: opts.severity ?? 'error',
  };
}

/**
 * Extract the intentId + correlationId from an event's metadata.
 * Used for command provenance in violations.
 */
export function eventCommand(event: StoredEvent): { intentId: string; correlationId: string } {
  return {
    intentId: event.metadata.intentId,
    correlationId: event.metadata.correlationId,
  };
}

/**
 * Filter events by type prefix (e.g., "payment." matches "payment.recorded").
 */
export function eventsByPrefix(events: StoredEvent[], prefix: string): StoredEvent[] {
  return events.filter((e) => e.type.startsWith(prefix));
}
