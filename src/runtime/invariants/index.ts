/**
 * Invariant Engine — barrel. (M-RT-20, Economic Integrity Hardening.)
 *
 * Public surface:
 *   - InvariantEngine          — the gate (verify / verifyOrThrow)
 *   - InvariantViolationError  — thrown when an invariant is violated
 *   - InvariantRegistry        — holds all registered invariants
 *   - BUILTIN_INVARIANTS       — the 9 economic invariants
 *   - Types                    — RuntimeInvariant, RuntimeSnapshot, etc.
 */

export * from './types';
export { pass, fail, violation, eventCommand, eventsByPrefix } from './result';
export { InvariantRegistry } from './registry';
export { InvariantEngine, InvariantViolationError } from './engine';
export {
  DoubleEntryInvariant,
  ReserveConservationInvariant,
  LiquidityInvariant,
  PaymentUniquenessInvariant,
  RefundLimitInvariant,
  RouteContinuityInvariant,
  SettlementUniquenessInvariant,
  FxRateExistsInvariant,
  CompilerHashInvariant,
  WalletAvailableNonNegativeInvariant,
  WalletReservedNonNegativeInvariant,
  WalletBalanceConsistencyInvariant,
  WalletDebitLimitInvariant,
  WalletReserveLimitInvariant,
  WalletReleaseLimitInvariant,
  BUILTIN_INVARIANTS,
} from './builtins';
