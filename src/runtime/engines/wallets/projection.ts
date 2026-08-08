/**
 * WalletProjection — rebuilds wallet state (including derived balances) from
 * the Domain Event stream. (M-RT-23, Wallet Capability Migration.)
 *
 * KEY DIFFERENCE from payments/refunds:
 *   Payments and refunds are append-only transaction streams — each event
 *   creates/updates a row, but the row's "balance" isn't derived from
 *   multiple events.
 *
 *   Wallets are STATEFUL AGGREGATES — the balance is DERIVED from the full
 *   event history:
 *     available = sum(credits) - sum(debits) - sum(reserved) + sum(released)
 *     reserved  = sum(reserved) - sum(released)
 *     total     = available + reserved
 *
 *   This projection demonstrates that the event-sourced runtime can support
 *   stateful financial aggregates, which is the foundation for treasury,
 *   reserves, and settlement accounting.
 *
 * INDEXES:
 *   - byId:       Map<walletId, WalletView>            (primary)
 *   - byAccount:  Map<accountId, walletId[]>           (per-account queries)
 *   - byCurrency: Map<currency, walletId[]>            (per-currency queries)
 */

import type { StoredEvent } from '../../events';
import type { Projection } from '../../read-models';
import type {
  WalletView,
  WalletListOptions,
  WalletCreatedPayload,
  WalletCreditedPayload,
  WalletDebitedPayload,
  WalletReservedPayload,
  WalletReleasedPayload,
  WalletClosedPayload,
} from './types';
import { WALLET_EVENT_PREFIXES } from './types';

/** Internal mutable state (rebuilt from events). */
interface WalletState {
  view: WalletView;
  // Internal accumulators (for deriving balances):
  totalCredits: number;
  totalDebits: number;
  totalReserved: number;
  totalReleased: number;
}

export class WalletProjection implements Projection {
  readonly name = 'wallets';
  readonly handles = [...WALLET_EVENT_PREFIXES];

  /** Primary store: walletId → WalletState. */
  private readonly byId = new Map<string, WalletState>();
  /** Secondary index: accountId → walletId[]. */
  private readonly byAccount = new Map<string, string[]>();
  /** Secondary index: currency → walletId[]. */
  private readonly byCurrency = new Map<string, string[]>();
  /** Last global position processed. */
  private lastPosition = -1;
  /** Total events applied (for health metrics). */
  private eventsAppliedCount = 0;
  /** Last rebuild duration (for health metrics). */
  private lastReplayMs: number | null = null;
  /**
   * H-6 fix (SEC-002, regrade 2026-08-08): event IDs already applied to a
   * *balance-mutating* event (credited/debited/reserved/released). Unlike
   * `applyCreated` (already idempotent via the `byId.has()` check),
   * `applyCredited`/`applyDebited`/etc. had no guard against the same
   * event being applied twice — if a subscriber redelivers an event (a
   * standard at-least-once event-sourcing hazard: a crash/restart before
   * a checkpoint persists, or a bug upstream), the balance would be
   * double-counted. `rebuild()` intentionally clears this set along with
   * everything else — a full replay from genesis is supposed to reapply
   * every event exactly once, which this correctly allows.
   */
  private readonly appliedEventIds = new Set<string>();

  // ── Projection interface ────────────────────────────────────────────────

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) {
      this.lastPosition = events[events.length - 1].globalPosition;
    }
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    const start = Date.now();
    this.byId.clear();
    this.byAccount.clear();
    this.byCurrency.clear();
    this.appliedEventIds.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (allEvents.length > 0) {
      this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
    }
    this.lastReplayMs = Date.now() - start;
  }

  checkpoint(): number {
    return this.lastPosition;
  }

  // ── Pure query methods ──────────────────────────────────────────────────

  /** List wallets, optionally filtered by account/currency. */
  list(opts?: WalletListOptions): WalletView[] {
    let ids: string[];
    if (opts?.accountId) {
      ids = this.byAccount.get(opts.accountId) ?? [];
    } else if (opts?.currency) {
      ids = this.byCurrency.get(opts.currency) ?? [];
    } else {
      ids = [...this.byId.keys()];
    }
    let views = ids.map((id) => this.byId.get(id)?.view).filter(Boolean) as WalletView[];
    // newest first
    views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const skip = opts?.skip ?? 0;
    const take = opts?.take ?? 50;
    return views.slice(skip, skip + take);
  }

  /** Get a single wallet by ID. */
  get(walletId: string): WalletView | null {
    return this.byId.get(walletId)?.view ?? null;
  }

  /** Get the current balance of a wallet (or null if not found). */
  getBalance(walletId: string): { available: number; reserved: number; total: number } | null {
    const state = this.byId.get(walletId);
    if (!state) return null;
    return {
      available: state.view.availableBalance,
      reserved: state.view.reservedBalance,
      total: state.view.totalBalance,
    };
  }

  /** List wallets for an account. */
  listByAccount(accountId: string): WalletView[] {
    const ids = this.byAccount.get(accountId) ?? [];
    return ids.map((id) => this.byId.get(id)?.view).filter(Boolean) as WalletView[];
  }

  /** Total wallet count. */
  count(): number {
    return this.byId.size;
  }

  /** Total available balance across all wallets (for health checks). */
  totalAvailableBalance(): number {
    let sum = 0;
    for (const state of this.byId.values()) {
      sum += state.view.availableBalance;
    }
    return sum;
  }

  /** Total reserved balance across all wallets. */
  totalReservedBalance(): number {
    let sum = 0;
    for (const state of this.byId.values()) {
      sum += state.view.reservedBalance;
    }
    return sum;
  }

  /** Events applied (for health metrics). */
  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  /** Last rebuild duration (for health metrics). */
  lastReplayDurationMs(): number | null {
    return this.lastReplayMs;
  }

  // ── Internal: apply one event ───────────────────────────────────────────

  private applyOne(event: StoredEvent): void {
    // SEC-002 fix: reject a redelivered event before it can double-count
    // a balance mutation. See `appliedEventIds` doc comment above.
    if (this.appliedEventIds.has(event.id)) return;
    this.appliedEventIds.add(event.id);

    switch (event.type) {
      case 'wallet.created':
        this.applyCreated(event);
        break;
      case 'wallet.credited':
        this.applyCredited(event);
        break;
      case 'wallet.debited':
        this.applyDebited(event);
        break;
      case 'wallet.reserved':
        this.applyReserved(event);
        break;
      case 'wallet.released':
        this.applyReleased(event);
        break;
      case 'wallet.closed':
        this.applyClosed(event);
        break;
      default:
        return;
    }
  }

  private applyCreated(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletCreatedPayload;
    if (this.byId.has(payload.walletId)) return; // idempotent

    const view: WalletView = {
      id: payload.walletId,
      accountId: payload.accountId,
      name: payload.name,
      currency: payload.currency,
      availableBalance: 0,
      reservedBalance: 0,
      totalBalance: 0,
      isDefault: payload.isDefault,
      isClosed: false,
      createdAt: new Date(payload.createdAt),
      lastUpdated: new Date(event.metadata.timestamp),
    };

    this.byId.set(payload.walletId, {
      view,
      totalCredits: 0,
      totalDebits: 0,
      totalReserved: 0,
      totalReleased: 0,
    });

    // Update byAccount index.
    const accountList = this.byAccount.get(payload.accountId) ?? [];
    accountList.push(payload.walletId);
    this.byAccount.set(payload.accountId, accountList);

    // Update byCurrency index.
    const currencyList = this.byCurrency.get(payload.currency) ?? [];
    currencyList.push(payload.walletId);
    this.byCurrency.set(payload.currency, currencyList);
  }

  private applyCredited(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletCreditedPayload;
    const state = this.byId.get(payload.walletId);
    if (!state) return;

    state.totalCredits += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyDebited(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletDebitedPayload;
    const state = this.byId.get(payload.walletId);
    if (!state) return;

    state.totalDebits += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyReserved(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletReservedPayload;
    const state = this.byId.get(payload.walletId);
    if (!state) return;

    state.totalReserved += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyReleased(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletReleasedPayload;
    const state = this.byId.get(payload.walletId);
    if (!state) return;

    state.totalReleased += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyClosed(event: StoredEvent): void {
    const payload = event.payload as unknown as WalletClosedPayload;
    const state = this.byId.get(payload.walletId);
    if (!state) return;

    state.view.isClosed = true;
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  /**
   * Recompute derived balances from the accumulators.
   *
   *   available = credits - debits - reserved + released
   *   reserved  = reserved - released
   *   total     = available + reserved
   *
   * This is the KEY difference from append-only projections: the balance
   * is DERIVED from the full event history, not stored on any single event.
   */
  private recomputeBalances(state: WalletState): void {
    const available = state.totalCredits - state.totalDebits - state.totalReserved + state.totalReleased;
    const reserved = state.totalReserved - state.totalReleased;
    state.view.availableBalance = available;
    state.view.reservedBalance = reserved;
    state.view.totalBalance = available + reserved;
  }
}
