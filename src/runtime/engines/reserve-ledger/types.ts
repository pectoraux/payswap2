/**
 * Reserve Ledger — the canonical state of every reserve through deterministic
 * state transitions. (M-RT-3.)
 *
 * SCOPE: accounting only. Available / Locked / Pending / Consumed / Released.
 * No pricing, no utilization, no scarcity, no forecasts, no optimization.
 * Those belong to M-RT-4 (Reserve Market).
 *
 * DISCIPLINE: the ledger is an event-derived projection, exactly like the
 * Capability Graph. The ledger is NEVER mutated directly. All state changes
 * flow through Domain Events. The projection rebuilds balances from events.
 * This gives: deterministic replay, auditing, simulation, time travel, Digital
 * Twin support — without additional work later.
 *
 * INVARIANTS (enforced before every event append):
 *   Available ≥ 0
 *   Locked ≥ 0
 *   Pending ≥ 0
 *   Consumed ≥ 0
 *   Released ≥ 0
 *   Available + Locked + Pending + Consumed + Released = Total
 *   No transition may violate those invariants.
 *   Every state transition must emit exactly one domain event.
 *   Replaying the same event stream must always reconstruct the same ledger.
 */

/** Backing policy — what backs this reserve's funds. */
export type BackingPolicy =
  | 'fiat_full'        // 100% fiat-backed
  | 'twin_token'       // backed by twin tokens (mint/burn)
  | 'stablecoin'       // backed by stablecoins
  | 'hybrid';          // mixed

/** The five balance buckets. All must be ≥ 0 at all times. */
export interface ReserveBalances {
  available: number;
  locked: number;
  pending: number;
  consumed: number;
  released: number;
}

/** A Reserve — the identity + policy. Balances are derived from events. */
export interface Reserve {
  id: string;
  asset: string;              // currency code (e.g. 'GHS', 'TwinGHS', 'USDC')
  owner: string;              // owner id (LP, Treasury, etc.)
  jurisdiction: string;       // compliance region (e.g. 'GH', 'KE')
  backingPolicy: BackingPolicy;
  createdAt: number;          // Runtime Clock
}

/** A reserve + its current derived balances. */
export interface ReserveState {
  reserve: Reserve;
  balances: ReserveBalances;
  /** The event stream version (for optimistic concurrency). */
  version: number;
}

/** The five transitions. Each maps to exactly one Domain Event. */
export type ReserveTransition =
  | 'lock'      // Available → Locked
  | 'unlock'    // Locked → Available
  | 'consume'   // Locked → Consumed
  | 'release'   // Consumed → Released
  | 'replenish'; // external → Available

/** The Domain Events the Reserve Ledger emits. */
export type ReserveEventType =
  | 'reserve.created'
  | 'reserve.funded'       // replenish
  | 'reserve.locked'       // lock
  | 'reserve.unlocked'     // unlock
  | 'reserve.consumed'     // consume
  | 'reserve.released'     // release
  | 'reserve.adjusted';    // manual adjustment (corrections only)

/** An uncommitted reserve event (before it's stored). Compatible with UncommittedEvent. */
export interface ReserveUncommittedEvent {
  type: ReserveEventType;
  streamId: string;           // `${environment}:reserve:${reserveId}`
  streamType: 'reserve';
  kind: 'domain';
  payload: ReserveEventPayload & Record<string, unknown>;
}

/** The payload of a reserve event. */
export interface ReserveEventPayload {
  reserveId: string;
  amount: number;
  reason: string;
  /** For lock/unlock/consume/release: the operation this reservation is for. */
  operationId?: string;
  /** For replenish: the source of funds. */
  source?: string;
  /** For reserve.created only: */
  asset?: string;
  owner?: string;
  jurisdiction?: string;
  backingPolicy?: BackingPolicy;
}

// ─── Invariants ─────────────────────────────────────────────────────────────

/**
 * Validate that a set of balances satisfies all invariants.
 * Returns an array of violation messages (empty = valid).
 */
export function validateInvariants(balances: ReserveBalances): string[] {
  const violations: string[] = [];
  if (balances.available < 0) violations.push('Available must be ≥ 0');
  if (balances.locked < 0) violations.push('Locked must be ≥ 0');
  if (balances.pending < 0) violations.push('Pending must be ≥ 0');
  if (balances.consumed < 0) violations.push('Consumed must be ≥ 0');
  if (balances.released < 0) violations.push('Released must be ≥ 0');
  return violations;
}

/**
 * Simulate a transition on a set of balances and return the resulting balances.
 * Does NOT mutate the input. Returns null if the transition is invalid (insufficient funds).
 */
export function simulateTransition(
  balances: ReserveBalances,
  transition: ReserveTransition,
  amount: number,
): ReserveBalances | null {
  if (amount < 0) return null; // amounts must be positive

  const next: ReserveBalances = { ...balances };

  switch (transition) {
    case 'replenish':
      next.available += amount;
      break;
    case 'lock':
      if (next.available < amount) return null;
      next.available -= amount;
      next.locked += amount;
      break;
    case 'unlock':
      if (next.locked < amount) return null;
      next.locked -= amount;
      next.available += amount;
      break;
    case 'consume':
      if (next.locked < amount) return null;
      next.locked -= amount;
      next.consumed += amount;
      break;
    case 'release':
      if (next.consumed < amount) return null;
      next.consumed -= amount;
      next.released += amount;
      break;
    default:
      return null;
  }

  return next;
}

/**
 * Check whether a transition is valid (would not violate invariants).
 * Returns { valid: boolean, violations: string[] }.
 */
export function checkTransition(
  balances: ReserveBalances,
  transition: ReserveTransition,
  amount: number,
): { valid: boolean; violations: string[] } {
  const simulated = simulateTransition(balances, transition, amount);
  if (simulated === null) {
    return { valid: false, violations: ['Transition would result in insufficient funds or invalid amount'] };
  }
  const violations = validateInvariants(simulated);
  return { valid: violations.length === 0, violations };
}

/** Total reserve = sum of all balance buckets. */
export function totalBalance(balances: ReserveBalances): number {
  return (
    balances.available +
    balances.locked +
    balances.pending +
    balances.consumed +
    balances.released
  );
}

/** Map a transition to its event type. */
export function transitionToEventType(transition: ReserveTransition): ReserveEventType {
  switch (transition) {
    case 'replenish': return 'reserve.funded';
    case 'lock': return 'reserve.locked';
    case 'unlock': return 'reserve.unlocked';
    case 'consume': return 'reserve.consumed';
    case 'release': return 'reserve.released';
  }
}
