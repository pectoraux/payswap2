/**
 * Runtime Commands — the ONLY way to mutate financial state. (M-RT-21.)
 *
 * Every financial mutation in PaySwap must flow through a Command:
 *
 *   Page/API → RuntimeDispatcher.dispatch(command) → compile → verify → append → project
 *
 * No direct Prisma writes. Ever. The ESLint rule `no-direct-prisma-write`
 * enforces this at the linter level.
 *
 * Commands are INTENT — they express WHAT should happen, not HOW. The
 * dispatcher compiles them into events, verifies invariants, and appends.
 *
 * Command = { type, payload, metadata }
 *   - type: the command type (e.g., "payment.create")
 *   - payload: the command-specific data
 *   - metadata: actor, environment, correlationId, causationId
 */

import type { Environment } from '../types';

// ─── Command Metadata ──────────────────────────────────────────────────────

/** Metadata attached to every command (for tracing + auth). */
export interface CommandMetadata {
  /** Who is issuing the command. */
  actor: { id: string; role: string };
  /** Which environment (sandbox | live). */
  environment: Environment;
  /** Correlation ID (for distributed tracing). */
  correlationId: string;
  /** Causation ID (the event that caused this command, if any). */
  causationId?: string;
  /** Where the command came from. */
  source: 'dashboard' | 'api' | 'sdk' | 'cli' | 'webhook' | 'system' | 'extension';
}

// ─── Command Interface ─────────────────────────────────────────────────────

/**
 * RuntimeCommand — the base interface every command implements.
 *
 * Commands are serializable (no functions, no class instances).
 * They flow through the dispatcher, get compiled into events,
 * pass invariant verification, and get appended to the EventStore.
 */
export interface RuntimeCommand<TType extends string = string, TPayload = unknown> {
  /** Command type (e.g., "payment.create", "refund.execute"). */
  type: TType;
  /** Command-specific payload. */
  payload: TPayload;
  /** Metadata (actor, environment, tracing). */
  metadata: CommandMetadata;
}

// ─── Payment Commands ──────────────────────────────────────────────────────

export interface CreatePaymentPayload {
  merchantId: string;
  customerId?: string;
  amount: number;
  currency: string;
  sourceCurrency?: string;
  destinationCurrency?: string;
  method?: string;
  corridor?: string;
  description?: string;
  reference?: string;
}

export type CreatePaymentCommand = RuntimeCommand<'payment.create', CreatePaymentPayload>;

export interface CapturePaymentPayload {
  paymentId: string;
  lpId?: string;
}

export type CapturePaymentCommand = RuntimeCommand<'payment.capture', CapturePaymentPayload>;

// ─── Refund Commands ───────────────────────────────────────────────────────

export interface CreateRefundPayload {
  paymentId: string;
  merchantId: string;
  amount: number;
  type: 'FULL' | 'PARTIAL';
  reason?: string;
  requestedBy: string;
}

export type CreateRefundCommand = RuntimeCommand<'refund.create', CreateRefundPayload>;

export interface ExecuteRefundPayload {
  refundId: string;
}

export type ExecuteRefundCommand = RuntimeCommand<'refund.execute', ExecuteRefundPayload>;

// ─── Payout Commands ───────────────────────────────────────────────────────

export interface CreatePayoutPayload {
  merchantId: string;
  method: string;
  sourceAmount: number;
  sourceAsset: string;
  sourceCurrency: string;
  destinationCurrency: string;
  destination?: string;
  reason?: string;
}

export type CreatePayoutCommand = RuntimeCommand<'payout.create', CreatePayoutPayload>;

// ─── Invoice Commands ──────────────────────────────────────────────────────

export interface CreateInvoicePayload {
  merchantId: string;
  customerId?: string;
  amount: number;
  currency: string;
  dueDate?: number;
  items?: { description: string; quantity: number; unitPrice: number }[];
}

export type CreateInvoiceCommand = RuntimeCommand<'invoice.create', CreateInvoicePayload>;

// ─── Reserve Commands ──────────────────────────────────────────────────────

export interface ReserveLiquidityPayload {
  reserveId: string;
  amount: number;
  reason: string;
}

export type ReserveLiquidityCommand = RuntimeCommand<'reserve.lock', ReserveLiquidityPayload>;

export interface ReleaseLiquidityPayload {
  reserveId: string;
  amount: number;
  reason: string;
}

export type ReleaseLiquidityCommand = RuntimeCommand<'reserve.release', ReleaseLiquidityPayload>;

// ─── Union of All Commands ─────────────────────────────────────────────────

export type AnyRuntimeCommand =
  | CreatePaymentCommand
  | CapturePaymentCommand
  | CreateRefundCommand
  | ExecuteRefundCommand
  | CreatePayoutCommand
  | CreateInvoiceCommand
  | ReserveLiquidityCommand
  | ReleaseLiquidityCommand;

/** All registered command types (for validation). */
export const COMMAND_TYPES = [
  'payment.create',
  'payment.capture',
  'refund.create',
  'refund.execute',
  'payout.create',
  'invoice.create',
  'reserve.lock',
  'reserve.release',
] as const;

export type CommandType = typeof COMMAND_TYPES[number];
