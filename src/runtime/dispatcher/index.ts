/**
 * Runtime Dispatcher — barrel. (M-RT-21, Runtime Enforcement.)
 *
 * Public surface:
 *   - RuntimeDispatcher — the ONLY way to mutate financial state
 *   - CommandRegistry   — holds all command handlers
 *   - CommandHandler    — interface for capability-specific handlers
 *   - BUILTIN_HANDLERS  — payment, refund, reserve handlers
 *   - Types             — RuntimeCommand, CommandMetadata, DispatchResult
 */

export * from './types';
export { CommandRegistry } from './registry';
export type { CommandHandler, CommandResult } from './registry';
export { RuntimeDispatcher } from './dispatcher';
export type { DispatchResult, DispatcherInputs } from './dispatcher';
export {
  PaymentCommandHandler,
  RefundCommandHandler,
  ExecuteRefundCommandHandler,
  ReserveLiquidityCommandHandler,
  ReleaseLiquidityCommandHandler,
  BUILTIN_HANDLERS,
} from './handlers';
