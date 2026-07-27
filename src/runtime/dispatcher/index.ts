/**
 * Runtime Dispatcher — barrel. (M-RT-21/22, Runtime Enforcement + Concurrency.)
 *
 * Public surface:
 *   - RuntimeDispatcher — the ONLY way to mutate financial state
 *   - CommandRegistry   — holds all command handlers
 *   - CommandHandler    — interface for capability-specific handlers
 *   - BUILTIN_HANDLERS  — payment, refund, reserve handlers
 *   - IdempotencyStore  — prevents duplicate command processing (M-RT-22)
 *   - RetryPolicy       — retries on OCC conflicts (M-RT-22)
 *   - Types             — RuntimeCommand, CommandMetadata, DispatchResult
 */

export * from './types';
export { CommandRegistry } from './registry';
export type { CommandHandler, CommandResult } from './registry';
export { RuntimeDispatcher } from './dispatcher';
export type { DispatchResult, DispatcherInputs } from './dispatcher';
export { IdempotencyStore } from './idempotency-store';
export type { CachedResult } from './idempotency-store';
export { RetryPolicy, defaultShouldRetry } from './retry-policy';
export type { RetryPolicyOptions, RetryOutcome } from './retry-policy';
export {
  PaymentCommandHandler,
  RefundCommandHandler,
  ExecuteRefundCommandHandler,
  ReserveLiquidityCommandHandler,
  ReleaseLiquidityCommandHandler,
  WalletCreditCommandHandler,
  WalletDebitCommandHandler,
  WalletReserveCommandHandler,
  WalletReleaseCommandHandler,
  BUILTIN_HANDLERS,
} from './handlers';
