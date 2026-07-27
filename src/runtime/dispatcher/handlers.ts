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
  WalletCreditCommand,
  WalletDebitCommand,
  WalletReserveCommand,
  WalletReleaseCommand,
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

// ─── Wallet Command Handlers (M-RT-23 + M-RT-24B) ──────────────────────────
//
// M-RT-24B: Wallet handlers now emit DUAL events:
//   1. wallet.* event (on the wallet stream) — for the wallet projection
//   2. treasury.account.* event (on the treasury stream) — for the treasury projection
//
// This ensures the treasury is the CANONICAL financial state. Wallets are
// claims on treasury, not independent balance owners.
//
//   Wallet → Treasury Account → Ledger → Reserves

/** Helper: build the treasury account ID for a wallet. */
function walletTreasuryAccountId(walletId: string): string {
  return `treasury_wallet_${walletId}`;
}

/** Helper: build the treasury stream ID for a wallet. */
function walletTreasuryStreamId(env: string, walletId: string): string {
  return `${env}:treasury:${walletTreasuryAccountId(walletId)}`;
}

/** Handles "wallet.credit" — produces wallet.credited + treasury.account.credited events. */
export class WalletCreditCommandHandler implements CommandHandler<WalletCreditCommand> {
  readonly commandType = 'wallet.credit';
  readonly description = 'Credit a wallet (produces wallet.credited + treasury.account.credited events)';

  handle(command: WalletCreditCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      // 1. Wallet event (for the wallet projection).
      {
        type: 'wallet.credited',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          counterparty: payload.counterparty ?? null,
          reference: payload.reference ?? null,
          txHash: null,
          reason: payload.reason,
          creditedAt: now,
        } as unknown as Record<string, unknown>,
      },
      // 2. Treasury event (for the treasury projection — canonical financial state).
      {
        type: 'treasury.account.credited',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          amount: payload.amount,
          currency: payload.currency,
          reason: `Wallet credit: ${payload.reason}`,
          counterparty: payload.counterparty ?? null,
          creditedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Credited ${payload.amount} ${payload.currency} to wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.debit" — produces wallet.debited + treasury.account.debited events. */
export class WalletDebitCommandHandler implements CommandHandler<WalletDebitCommand> {
  readonly commandType = 'wallet.debit';
  readonly description = 'Debit a wallet (produces wallet.debited + treasury.account.debited events)';

  handle(command: WalletDebitCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.debited',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          counterparty: payload.counterparty ?? null,
          reference: payload.reference ?? null,
          txHash: null,
          reason: payload.reason,
          debitedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.account.debited',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          amount: payload.amount,
          currency: payload.currency,
          reason: `Wallet debit: ${payload.reason}`,
          counterparty: payload.counterparty ?? null,
          debitedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Debited ${payload.amount} ${payload.currency} from wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.reserve" — produces wallet.reserved + treasury.position.opened events. */
export class WalletReserveCommandHandler implements CommandHandler<WalletReserveCommand> {
  readonly commandType = 'wallet.reserve';
  readonly description = 'Reserve wallet balance (produces wallet.reserved + treasury.position.opened events)';

  handle(command: WalletReserveCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.reserved',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
          operationId: payload.operationId,
          reservedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.position.opened',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          positionType: 'lp',
          reference: payload.operationId,
          amount: payload.amount,
          currency: payload.currency,
          terms: payload.reason,
          openedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Reserved ${payload.amount} ${payload.currency} in wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.release" — produces wallet.released + treasury.position.closed events. */
export class WalletReleaseCommandHandler implements CommandHandler<WalletReleaseCommand> {
  readonly commandType = 'wallet.release';
  readonly description = 'Release reserved wallet balance (produces wallet.released + treasury.position.closed events)';

  handle(command: WalletReleaseCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.released',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
          operationId: payload.operationId,
          releasedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.position.closed',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          closeAmount: payload.amount,
          reason: payload.reason,
          closedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Released ${payload.amount} ${payload.currency} from wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
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
  new WalletCreditCommandHandler(),
  new WalletDebitCommandHandler(),
  new WalletReserveCommandHandler(),
  new WalletReleaseCommandHandler(),
];
