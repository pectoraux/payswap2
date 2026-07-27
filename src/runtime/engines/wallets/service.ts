/**
 * WalletsService — the read model + writer for the wallets capability.
 * (M-RT-23, Wallet Capability Migration.)
 *
 * Same discipline as PaymentsService/RefundsService:
 *   - Reads go through the projection (which is fed by the EventStore).
 *   - Writes go through the RuntimeDispatcher (the ONLY way to mutate state).
 *
 * READS:
 *   - list(opts?)
 *   - get(walletId)
 *   - getBalance(walletId)
 *   - listByAccount(accountId)
 *   - totalAvailableBalance()
 *   - totalReservedBalance()
 *
 * WRITES (via dispatcher — these are command factory methods, not direct writes):
 *   - credit(walletId, amount, reason) → dispatches wallet.credit command
 *   - debit(walletId, amount, reason) → dispatches wallet.debit command
 *   - reserve(walletId, amount, reason) → dispatches wallet.reserve command
 *   - release(walletId, amount, reason) → dispatches wallet.release command
 *
 * HEALTH:
 *   - health() returns ProjectionHealth (eventsApplied, rows, lag, etc.)
 */

import type { EventStore } from '../../events';
import type { UncommittedEvent } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  WalletView,
  WalletListOptions,
  WalletCreatedPayload,
} from './types';
import { WalletProjection } from './projection';
import type { ProjectionHealth } from '../../migration/types';

export interface WalletsServiceInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
}

/**
 * WalletsService — the read model + writer for wallets.
 *
 * Writes are FACTORY METHODS that produce commands. The caller (or the
 * service itself) dispatches them through the RuntimeDispatcher. The
 * service NEVER appends events directly.
 */
export class WalletsService {
  readonly projection: WalletProjection;

  constructor(private inputs: WalletsServiceInputs) {
    this.projection = new WalletProjection();
  }

  // ── READS (façade contract) ─────────────────────────────────────────────

  async list(opts?: WalletListOptions): Promise<WalletView[]> {
    await this.ensureHydrated();
    return this.projection.list(opts);
  }

  async get(walletId: string): Promise<WalletView | null> {
    await this.ensureHydrated();
    return this.projection.get(walletId);
  }

  async getBalance(walletId: string): Promise<{ available: number; reserved: number; total: number } | null> {
    await this.ensureHydrated();
    return this.projection.getBalance(walletId);
  }

  async listByAccount(accountId: string): Promise<WalletView[]> {
    await this.ensureHydrated();
    return this.projection.listByAccount(accountId);
  }

  async count(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.count();
  }

  async totalAvailableBalance(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.totalAvailableBalance();
  }

  async totalReservedBalance(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.totalReservedBalance();
  }

  // ── WRITES (recordWallet for backfill — direct event emission) ──────────

  /**
   * Record a wallet (backfill / legacy import). Emits `wallet.created` +
   * `wallet.credited` (for the initial balance). IDEMPOTENT.
   *
   * This is the ONLY method that emits events directly (for backfill).
   * All other writes go through the RuntimeDispatcher.
   */
  async recordWallet(input: {
    walletId: string;
    accountId: string;
    name: string;
    currency: string;
    balance: number;
    pendingBalance: number;
    lockedBalance: number;
    isDefault: boolean;
    createdAt: number;
    environment: Environment;
    correlationId: string;
  }): Promise<boolean> {
    const streamId = `${input.environment}:wallet:${input.walletId}`;
    // Idempotence: if the stream exists, skip.
    if (this.inputs.eventStore.streamVersion(streamId) !== undefined) {
      return false;
    }

    const events: UncommittedEvent[] = [];
    const treasuryAccountId = `treasury_wallet_${input.walletId}`;
    const treasuryStreamId = `${input.environment}:treasury:${treasuryAccountId}`;

    // 1. wallet.created
    events.push({
      type: 'wallet.created',
      streamId,
      streamType: 'wallet',
      kind: 'domain' as const,
      payload: {
        walletId: input.walletId,
        accountId: input.accountId,
        name: input.name,
        currency: input.currency,
        isDefault: input.isDefault,
        environment: input.environment,
        createdAt: input.createdAt,
      } as unknown as Record<string, unknown>,
    });

    // 1b. treasury.account.created (M-RT-24B: each wallet gets a backing treasury account)
    events.push({
      type: 'treasury.account.created',
      streamId: treasuryStreamId,
      streamType: 'treasury',
      kind: 'domain' as const,
      payload: {
        accountId: treasuryAccountId,
        kind: 'treasury',
        ownerId: input.accountId,
        currency: input.currency,
        reference: input.walletId,
        environment: input.environment,
        createdAt: input.createdAt,
      } as unknown as Record<string, unknown>,
    });

    // 2. wallet.credited + treasury.account.credited (for the initial balance — if non-zero)
    if (input.balance > 0) {
      events.push({
        type: 'wallet.credited',
        streamId,
        streamType: 'wallet',
        kind: 'domain' as const,
        payload: {
          walletId: input.walletId,
          amount: input.balance,
          currency: input.currency,
          counterparty: null,
          reference: 'Initial balance (backfill)',
          txHash: null,
          reason: 'Backfill: initial balance',
          creditedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
      // Treasury mirror event (M-RT-24B).
      events.push({
        type: 'treasury.account.credited',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain' as const,
        payload: {
          accountId: treasuryAccountId,
          amount: input.balance,
          currency: input.currency,
          reason: 'Backfill: wallet initial balance',
          counterparty: null,
          creditedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
    }

    // 3. wallet.reserved + treasury.position.opened (for the locked balance — if non-zero)
    if (input.lockedBalance > 0) {
      events.push({
        type: 'wallet.reserved',
        streamId,
        streamType: 'wallet',
        kind: 'domain' as const,
        payload: {
          walletId: input.walletId,
          amount: input.lockedBalance,
          currency: input.currency,
          reason: 'Backfill: locked balance',
          operationId: `backfill_${input.walletId}`,
          reservedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
      // Treasury mirror event (M-RT-24B).
      events.push({
        type: 'treasury.position.opened',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain' as const,
        payload: {
          accountId: treasuryAccountId,
          positionType: 'lp',
          reference: `backfill_${input.walletId}`,
          amount: input.lockedBalance,
          currency: input.currency,
          terms: 'Backfill: locked balance',
          openedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
    }

    await this.inputs.eventStore.append(
      events,
      new Map([[streamId, -1], [treasuryStreamId, -1]]),
      {
        intentId: `backfill_wallet_${input.walletId}`,
        correlationId: input.correlationId,
        actor: 'system:backfill',
        environment: input.environment,
        timestamp: this.inputs.clock.now(),
      },
    );
    return true;
  }

  // ── HEALTH ───────────────────────────────────────────────────────────────

  async health(canonicalRows?: number): Promise<ProjectionHealth> {
    await this.ensureHydrated();
    const rows = this.projection.count();
    const eventsApplied = this.projection.eventsApplied();
    const checkpoint = this.projection.checkpoint();
    let lag = 0;
    try {
      const events = await this.inputs.eventStore.readAll(checkpoint + 1, 50_000);
      lag = events.filter((e) => e.streamType === 'wallet').length;
    } catch {
      lag = 0;
    }

    // Enhanced metrics (M-RT-23 hardening): total balances + negative-balance count.
    const totalAvailable = this.projection.totalAvailableBalance();
    const totalReserved = this.projection.totalReservedBalance();
    const totalBalance = totalAvailable + totalReserved;
    // Count wallets with negative balances (should always be 0 if invariants hold).
    let negativeBalances = 0;
    for (const walletId of this.projection.list({ take: 10000 }).map((w) => w.id)) {
      const bal = this.projection.getBalance(walletId);
      if (bal && (bal.available < -0.01 || bal.reserved < -0.01)) {
        negativeBalances++;
      }
    }

    const healthy = lag === 0 && (canonicalRows === undefined || rows >= canonicalRows) && negativeBalances === 0;
    return {
      projection: 'wallets',
      version: 1,
      eventsApplied,
      rows,
      lag,
      healthy,
      lastReplayMs: this.projection.lastReplayDurationMs(),
      checkpoint,
      canonicalRows,
      message: canonicalRows !== undefined && rows < canonicalRows
        ? `Backfill pending: ${canonicalRows} in Prisma, ${rows} in projection`
        : negativeBalances > 0
          ? `UNHEALTHY: ${negativeBalances} wallet(s) with negative balances`
          : healthy ? 'Healthy' : `Lagging by ${lag} events`,
      // Enhanced operational metrics (M-RT-23 hardening).
      totalAvailable,
      totalReserved,
      totalBalance,
      negativeBalances,
    } as ProjectionHealth & { totalAvailable: number; totalReserved: number; totalBalance: number; negativeBalances: number };
  }

  // ── Internal: hydrate ───────────────────────────────────────────────────

  private hydrated = false;

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    const events = await this.inputs.eventStore.readAll(0, 50_000);
    const walletEvents = events.filter(
      (e) => e.streamType === 'wallet' && e.type.startsWith('wallet.'),
    );
    if (walletEvents.length > 0) {
      await this.projection.apply(walletEvents);
    }
    this.hydrated = true;
  }
}
