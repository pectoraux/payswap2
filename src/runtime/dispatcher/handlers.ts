/**
 * Built-in Command Handlers. (M-RT-21, Phase 4.)
 *
 * Each handler processes one command type and produces events.
 * Handlers are PURE: they compute events, they don't append them.
 *
 * The dispatcher handles the actual append (after invariant verification).
 */

import type { RuntimeCommand } from './types';
import type { CommandHandler, CommandResult } from './registry';
import type { UncommittedEvent } from '../events';
import type { RuntimeSnapshot } from '../invariants';
import type { Environment } from '../types';
import { uid } from '../types';
import type {
  CreatePaymentCommand,
  CreatePaymentPayload,
  CreateRefundCommand,
  CreateRefundPayload,
  ExecuteRefundCommand,
  ReserveLiquidityCommand,
  ReleaseLiquidityCommand,
} from './types';

// ─── Payment Command Handler ───────────────────────────────────────────────

/** Handles "payment.create" — produces a payment.recorded event. */
export class PaymentCommandHandler implements CommandHandler<CreatePaymentCommand> {
  readonly commandType = 'payment.create';
  readonly description = 'Create a new payment (produces payment.recorded event)';

  handle(command: CreatePaymentCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const paymentId = uid('pay');
    const streamId = `${command.metadata.environment}:payment:${paymentId}`;

    const event: UncommittedEvent = {
      type: 'payment.recorded',
      streamId,
      streamType: 'payment',
      kind: 'domain',
      payload: {
        paymentId,
        merchantId: payload.merchantId,
        customerId: payload.customerId ?? null,
        reference: payload.reference ?? null,
        amount: payload.amount,
        currency: payload.currency,
        sourceCurrency: payload.sourceCurrency ?? null,
        destinationCurrency: payload.destinationCurrency ?? null,
        status: 'PENDING',
        method: payload.method ?? null,
        corridor: payload.corridor ?? null,
        lpId: null,
        fee: 0,
        netAmount: payload.amount,
        fxRate: 1,
        description: payload.description ?? null,
        createdAt: Date.now(),
        settledAt: null,
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: paymentId,
      message: `Payment ${paymentId} created`,
    };
  }
}

// ─── Refund Command Handlers ───────────────────────────────────────────────

/** Handles "refund.create" — produces a refund.requested event. */
export class RefundCommandHandler implements CommandHandler<CreateRefundCommand> {
  readonly commandType = 'refund.create';
  readonly description = 'Create a new refund request (produces refund.requested event)';

  handle(command: CreateRefundCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const refundId = uid('ref');
    const streamId = `${command.metadata.environment}:refund:${refundId}`;

    const event: UncommittedEvent = {
      type: 'refund.requested',
      streamId,
      streamType: 'refund',
      kind: 'domain',
      payload: {
        refundId,
        merchantId: payload.merchantId,
        paymentId: payload.paymentId,
        amount: payload.amount,
        type: payload.type,
        reason: payload.reason ?? null,
        status: 'PENDING',
        requestedBy: payload.requestedBy,
        environment: command.metadata.environment,
        createdAt: Date.now(),
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: refundId,
      message: `Refund ${refundId} created`,
    };
  }
}

/** Handles "refund.execute" — produces a refund.executed event. */
export class ExecuteRefundCommandHandler implements CommandHandler<ExecuteRefundCommand> {
  readonly commandType = 'refund.execute';
  readonly description = 'Execute a refund (produces refund.executed event)';

  handle(command: ExecuteRefundCommand, snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const refund = snapshot.refunds.get(payload.refundId) as { status?: string; merchantId?: string } | undefined;

    if (!refund) {
      return {
        success: false,
        commandType: this.commandType,
        events: [],
        message: `Refund ${payload.refundId} not found`,
        error: 'REFUND_NOT_FOUND',
      };
    }

    if (refund.status !== 'APPROVED') {
      return {
        success: false,
        commandType: this.commandType,
        events: [],
        message: `Refund ${payload.refundId} is not APPROVED (current: ${refund.status})`,
        error: 'REFUND_NOT_APPROVED',
      };
    }

    const streamId = `${command.metadata.environment}:refund:${payload.refundId}`;
    const event: UncommittedEvent = {
      type: 'refund.executed',
      streamId,
      streamType: 'refund',
      kind: 'domain',
      payload: {
        refundId: payload.refundId,
        executedAt: Date.now(),
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.refundId,
      message: `Refund ${payload.refundId} executed`,
    };
  }
}

// ─── Reserve Command Handlers ──────────────────────────────────────────────

/** Handles "reserve.lock" — produces a reserve.locked event. */
export class ReserveLiquidityCommandHandler implements CommandHandler<ReserveLiquidityCommand> {
  readonly commandType = 'reserve.lock';
  readonly description = 'Lock liquidity in a reserve (produces reserve.locked event)';

  handle(command: ReserveLiquidityCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const streamId = `${command.metadata.environment}:reserve:${payload.reserveId}`;

    const event: UncommittedEvent = {
      type: 'reserve.locked',
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId: payload.reserveId,
        amount: payload.amount,
        reason: payload.reason,
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.reserveId,
      message: `Locked ${payload.amount} in reserve ${payload.reserveId}`,
    };
  }
}

/** Handles "reserve.release" — produces a reserve.released event. */
export class ReleaseLiquidityCommandHandler implements CommandHandler<ReleaseLiquidityCommand> {
  readonly commandType = 'reserve.release';
  readonly description = 'Release liquidity from a reserve (produces reserve.released event)';

  handle(command: ReleaseLiquidityCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const streamId = `${command.metadata.environment}:reserve:${payload.reserveId}`;

    const event: UncommittedEvent = {
      type: 'reserve.released',
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId: payload.reserveId,
        amount: payload.amount,
        reason: payload.reason,
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.reserveId,
      message: `Released ${payload.amount} from reserve ${payload.reserveId}`,
    };
  }
}

// ─── All Built-in Handlers ─────────────────────────────────────────────────

/** All built-in command handlers, in registration order. */
export const BUILTIN_HANDLERS: CommandHandler[] = [
  new PaymentCommandHandler(),
  new RefundCommandHandler(),
  new ExecuteRefundCommandHandler(),
  new ReserveLiquidityCommandHandler(),
  new ReleaseLiquidityCommandHandler(),
];
