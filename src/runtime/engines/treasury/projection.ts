/**
 * TreasuryProjection — rebuilds all 5 treasury account types from events.
 * (M-RT-24, Treasury Kernel.)
 *
 * Same derived-balance pattern as WalletProjection (M-RT-23):
 *   available = credits - debits
 *   reserved  = sum(reserved by positions) - sum(released by positions)
 *   total     = available + reserved
 *
 * INDEXES:
 *   - byId:       Map<accountId, TreasuryAccountView>
 *   - byKind:     Map<AccountKind, accountId[]>
 *   - byOwner:    Map<ownerId, accountId[]>
 *   - byCurrency: Map<currency, accountId[]>
 */

import type { StoredEvent } from '../../events';
import type { Projection } from '../../read-models';
import type {
  TreasuryAccountView,
  TreasuryListOptions,
  AccountKind,
  TreasuryAccountCreatedPayload,
  TreasuryAccountCreditedPayload,
  TreasuryAccountDebitedPayload,
  TreasuryPositionOpenedPayload,
  TreasuryPositionClosedPayload,
  TreasuryTransferExecutedPayload,
} from './types';
import { TREASURY_EVENT_PREFIXES } from './types';

interface TreasuryAccountState {
  view: TreasuryAccountView;
  totalCredits: number;
  totalDebits: number;
  totalReserved: number;
  totalReleased: number;
}

export class TreasuryProjection implements Projection {
  readonly name = 'treasury';
  readonly handles = [...TREASURY_EVENT_PREFIXES];

  private readonly byId = new Map<string, TreasuryAccountState>();
  private readonly byKind = new Map<AccountKind, string[]>();
  private readonly byOwner = new Map<string, string[]>();
  private readonly byCurrency = new Map<string, string[]>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;
  private lastReplayMs: number | null = null;

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
    this.byKind.clear();
    this.byOwner.clear();
    this.byCurrency.clear();
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

  // ── Query methods ───────────────────────────────────────────────────────

  list(opts?: TreasuryListOptions): TreasuryAccountView[] {
    let ids: string[];
    if (opts?.kind) {
      ids = this.byKind.get(opts.kind) ?? [];
    } else if (opts?.ownerId) {
      ids = this.byOwner.get(opts.ownerId) ?? [];
    } else if (opts?.currency) {
      ids = this.byCurrency.get(opts.currency) ?? [];
    } else {
      ids = [...this.byId.keys()];
    }
    let views = ids.map((id) => this.byId.get(id)?.view).filter(Boolean) as TreasuryAccountView[];
    views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const skip = opts?.skip ?? 0;
    const take = opts?.take ?? 50;
    return views.slice(skip, skip + take);
  }

  get(accountId: string): TreasuryAccountView | null {
    return this.byId.get(accountId)?.view ?? null;
  }

  getBalance(accountId: string): { available: number; reserved: number; total: number } | null {
    const state = this.byId.get(accountId);
    if (!state) return null;
    return {
      available: state.view.availableBalance,
      reserved: state.view.reservedBalance,
      total: state.view.totalBalance,
    };
  }

  listByKind(kind: AccountKind): TreasuryAccountView[] {
    const ids = this.byKind.get(kind) ?? [];
    return ids.map((id) => this.byId.get(id)?.view).filter(Boolean) as TreasuryAccountView[];
  }

  listByOwner(ownerId: string): TreasuryAccountView[] {
    const ids = this.byOwner.get(ownerId) ?? [];
    return ids.map((id) => this.byId.get(id)?.view).filter(Boolean) as TreasuryAccountView[];
  }

  count(): number {
    return this.byId.size;
  }

  countByKind(kind: AccountKind): number {
    return this.byKind.get(kind)?.length ?? 0;
  }

  totalAvailableBalance(): number {
    let sum = 0;
    for (const state of this.byId.values()) sum += state.view.availableBalance;
    return sum;
  }

  totalReservedBalance(): number {
    let sum = 0;
    for (const state of this.byId.values()) sum += state.view.reservedBalance;
    return sum;
  }

  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  lastReplayDurationMs(): number | null {
    return this.lastReplayMs;
  }

  // ── Internal: apply one event ───────────────────────────────────────────

  private applyOne(event: StoredEvent): void {
    switch (event.type) {
      case 'treasury.account.created': this.applyCreated(event); break;
      case 'treasury.account.credited': this.applyCredited(event); break;
      case 'treasury.account.debited': this.applyDebited(event); break;
      case 'treasury.position.opened': this.applyPositionOpened(event); break;
      case 'treasury.position.closed': this.applyPositionClosed(event); break;
      case 'treasury.transfer.executed': this.applyTransferExecuted(event); break;
      default: break; // transfer.requested + reconciliation.run don't change balances
    }
  }

  private applyCreated(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryAccountCreatedPayload;
    if (this.byId.has(payload.accountId)) return;

    const view: TreasuryAccountView = {
      id: payload.accountId,
      kind: payload.kind,
      ownerId: payload.ownerId,
      currency: payload.currency,
      availableBalance: 0,
      reservedBalance: 0,
      totalBalance: 0,
      reference: payload.reference,
      isActive: true,
      createdAt: new Date(payload.createdAt),
      lastUpdated: new Date(event.metadata.timestamp),
    };

    this.byId.set(payload.accountId, {
      view,
      totalCredits: 0,
      totalDebits: 0,
      totalReserved: 0,
      totalReleased: 0,
    });

    const kindList = this.byKind.get(payload.kind) ?? [];
    kindList.push(payload.accountId);
    this.byKind.set(payload.kind, kindList);

    const ownerList = this.byOwner.get(payload.ownerId) ?? [];
    ownerList.push(payload.accountId);
    this.byOwner.set(payload.ownerId, ownerList);

    const currencyList = this.byCurrency.get(payload.currency) ?? [];
    currencyList.push(payload.accountId);
    this.byCurrency.set(payload.currency, currencyList);
  }

  private applyCredited(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryAccountCreditedPayload;
    const state = this.byId.get(payload.accountId);
    if (!state) return;
    state.totalCredits += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyDebited(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryAccountDebitedPayload;
    const state = this.byId.get(payload.accountId);
    if (!state) return;
    state.totalDebits += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyPositionOpened(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryPositionOpenedPayload;
    const state = this.byId.get(payload.accountId);
    if (!state) return;
    state.totalReserved += payload.amount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyPositionClosed(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryPositionClosedPayload;
    const state = this.byId.get(payload.accountId);
    if (!state) return;
    state.totalReleased += payload.closeAmount;
    this.recomputeBalances(state);
    state.view.lastUpdated = new Date(event.metadata.timestamp);
  }

  private applyTransferExecuted(event: StoredEvent): void {
    const payload = event.payload as unknown as TreasuryTransferExecutedPayload;
    // Debit from source account.
    const fromState = this.byId.get(payload.fromAccountId);
    if (fromState) {
      fromState.totalDebits += payload.amount;
      this.recomputeBalances(fromState);
      fromState.view.lastUpdated = new Date(event.metadata.timestamp);
    }
    // Credit to destination account.
    const toState = this.byId.get(payload.toAccountId);
    if (toState) {
      toState.totalCredits += payload.amount;
      this.recomputeBalances(toState);
      toState.view.lastUpdated = new Date(event.metadata.timestamp);
    }
  }

  private recomputeBalances(state: TreasuryAccountState): void {
    const available = state.totalCredits - state.totalDebits - state.totalReserved + state.totalReleased;
    const reserved = state.totalReserved - state.totalReleased;
    state.view.availableBalance = available;
    state.view.reservedBalance = reserved;
    state.view.totalBalance = available + reserved;
  }
}
