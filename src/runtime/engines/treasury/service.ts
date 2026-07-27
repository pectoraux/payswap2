/**
 * TreasuryService — the read model + writer for the treasury kernel.
 * (M-RT-24, Treasury Kernel.)
 *
 * Same discipline as WalletsService:
 *   - Reads go through the projection.
 *   - Writes go through the RuntimeDispatcher.
 *   - recordAccount() is the ONLY direct event emitter (for backfill).
 */

import type { EventStore } from '../../events';
import type { UncommittedEvent } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type { TreasuryAccountView, TreasuryListOptions, AccountKind } from './types';
import { TreasuryProjection } from './projection';
import type { ProjectionHealth } from '../../migration/types';

export interface TreasuryServiceInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
}

export class TreasuryService {
  readonly projection: TreasuryProjection;

  constructor(private inputs: TreasuryServiceInputs) {
    this.projection = new TreasuryProjection();
  }

  // ── READS ───────────────────────────────────────────────────────────────

  async list(opts?: TreasuryListOptions): Promise<TreasuryAccountView[]> {
    await this.ensureHydrated();
    return this.projection.list(opts);
  }

  async get(accountId: string): Promise<TreasuryAccountView | null> {
    await this.ensureHydrated();
    return this.projection.get(accountId);
  }

  async getBalance(accountId: string): Promise<{ available: number; reserved: number; total: number } | null> {
    await this.ensureHydrated();
    return this.projection.getBalance(accountId);
  }

  async listByKind(kind: AccountKind): Promise<TreasuryAccountView[]> {
    await this.ensureHydrated();
    return this.projection.listByKind(kind);
  }

  async listByOwner(ownerId: string): Promise<TreasuryAccountView[]> {
    await this.ensureHydrated();
    return this.projection.listByOwner(ownerId);
  }

  async count(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.count();
  }

  async countByKind(kind: AccountKind): Promise<number> {
    await this.ensureHydrated();
    return this.projection.countByKind(kind);
  }

  async totalAvailableBalance(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.totalAvailableBalance();
  }

  async totalReservedBalance(): Promise<number> {
    await this.ensureHydrated();
    return this.projection.totalReservedBalance();
  }

  // ── WRITES (backfill — direct event emission) ───────────────────────────

  async recordAccount(input: {
    accountId: string;
    kind: AccountKind;
    ownerId: string;
    currency: string;
    balance: number;
    reservedBalance: number;
    reference: string | null;
    createdAt: number;
    environment: Environment;
    correlationId: string;
  }): Promise<boolean> {
    const streamId = `${input.environment}:treasury:${input.accountId}`;
    if (this.inputs.eventStore.streamVersion(streamId) !== undefined) {
      return false; // idempotent
    }

    const events: UncommittedEvent[] = [];
    events.push({
      type: 'treasury.account.created',
      streamId,
      streamType: 'treasury',
      kind: 'domain',
      payload: {
        accountId: input.accountId,
        kind: input.kind,
        ownerId: input.ownerId,
        currency: input.currency,
        reference: input.reference,
        environment: input.environment,
        createdAt: input.createdAt,
      } as unknown as Record<string, unknown>,
    });

    if (input.balance > 0) {
      events.push({
        type: 'treasury.account.credited',
        streamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: input.accountId,
          amount: input.balance,
          currency: input.currency,
          reason: 'Backfill: initial balance',
          counterparty: null,
          creditedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
    }

    if (input.reservedBalance > 0) {
      events.push({
        type: 'treasury.position.opened',
        streamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: input.accountId,
          positionType: 'lp',
          reference: input.reference ?? 'backfill',
          amount: input.reservedBalance,
          currency: input.currency,
          terms: null,
          openedAt: input.createdAt,
        } as unknown as Record<string, unknown>,
      });
    }

    await this.inputs.eventStore.append(
      events,
      new Map([[streamId, -1]]),
      {
        intentId: `backfill_treasury_${input.accountId}`,
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
      lag = events.filter((e) => e.streamType === 'treasury').length;
    } catch {
      lag = 0;
    }

    const totalAvailable = this.projection.totalAvailableBalance();
    const totalReserved = this.projection.totalReservedBalance();
    const totalBalance = totalAvailable + totalReserved;
    let negativeBalances = 0;
    for (const view of this.projection.list({ take: 10000 })) {
      if (view.availableBalance < -0.01 || view.reservedBalance < -0.01) {
        negativeBalances++;
      }
    }

    const healthy = lag === 0 && (canonicalRows === undefined || rows >= canonicalRows) && negativeBalances === 0;
    return {
      projection: 'treasury',
      version: 1,
      eventsApplied,
      rows,
      lag,
      healthy,
      lastReplayMs: this.projection.lastReplayDurationMs(),
      checkpoint,
      canonicalRows,
      message: negativeBalances > 0
        ? `UNHEALTHY: ${negativeBalances} account(s) with negative balances`
        : healthy ? 'Healthy' : `Lagging by ${lag} events`,
      totalAvailable,
      totalReserved,
      totalBalance,
      negativeBalances,
    } as ProjectionHealth & { totalAvailable: number; totalReserved: number; totalBalance: number; negativeBalances: number };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private hydrated = false;

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    const events = await this.inputs.eventStore.readAll(0, 50_000);
    const treasuryEvents = events.filter(
      (e) => e.streamType === 'treasury' && e.type.startsWith('treasury.'),
    );
    if (treasuryEvents.length > 0) {
      await this.projection.apply(treasuryEvents);
    }
    this.hydrated = true;
  }
}
