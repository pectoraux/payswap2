/**
 * LP Settlement Store — in-memory store for settlement orders that couldn't
 * be absorbed by existing bandwidth, and for LP-locked stablecoins.
 *
 * (Task FEATURES-1.)
 *
 * This module is a NEW layer parallel to `src/runtime/`, `src/identity/`,
 * `src/trust/`, `src/ops/`. It does NOT modify the Prisma schema (constraint:
 * frozen). All settlement-order + locked-stablecoin records live in a
 * process-wide singleton on `globalThis.__PAYSWAP_LP_SETTLEMENT_STORE__` so
 * Next.js dev-mode module re-instantiation does not lose data.
 *
 * Two record kinds live here:
 *
 * 1. `SettlementOrder` — a payment-side settlement that couldn't get absorbed
 *    by existing LP bandwidth. It sits in `pending` status until an LP claims
 *    it (offering their own liquidity to settle it). After claim, the order
 *    is `matched` and eventually `settled`.
 *
 * 2. `LockedStablecoin` — stablecoins that an LP locked up during a transfer
 *    that didn't complete. They can be unlocked (released back to the LP's
 *    available balance) once the failure window elapses or the LP manually
 *    requests an unlock.
 */

import { uid } from '@/runtime/types';

// ─── Settlement order ────────────────────────────────────────────────────────

export type SettlementOrderStatus =
  | 'pending'      // waiting for an LP to claim
  | 'matched'      // an LP claimed the order
  | 'settled'      // the settlement completed
  | 'expired'      // no LP claimed before the deadline
  | 'cancelled';   // manually cancelled

export interface SettlementOrder {
  id: string;
  /** Corridor key, e.g. "GHS→KES". */
  corridor: string;
  /** Source currency (e.g. GHS). */
  sourceCurrency: string;
  /** Destination currency (e.g. KES). */
  destinationCurrency: string;
  /** Amount in the source currency. */
  amount: number;
  /** Optional fee budget the LP earns for absorbing the order. */
  feeBps: number;
  /** Status. */
  status: SettlementOrderStatus;
  /** Reason this order couldn't be auto-absorbed (free text). */
  reason: string;
  /** Original payment reference (for traceability). */
  paymentReference?: string;
  /** ISO timestamp (ms) when the order was created. */
  createdAt: number;
  /** ISO timestamp (ms) by which an LP must claim. */
  deadlineAt: number;
  /** LP ID of the LP that claimed the order (if matched). */
  claimedByLpId?: string;
  /** ISO timestamp (ms) when the order was claimed. */
  claimedAt?: number;
  /** ISO timestamp (ms) when the order was settled. */
  settledAt?: number;
}

// ─── Locked stablecoin ───────────────────────────────────────────────────────

export type LockedStablecoinStatus = 'locked' | 'unlocked' | 'released';

export interface LockedStablecoin {
  id: string;
  /** LP ID that owns the locked stablecoins. */
  lpId: string;
  /** Amount locked. */
  amount: number;
  /** Currency code (e.g. USD, GHS, KES). */
  currency: string;
  /** Why the stablecoins were locked. */
  reason: string;
  /** Original transfer / payment reference (for traceability). */
  transferReference?: string;
  /** Status. */
  status: LockedStablecoinStatus;
  /** ISO timestamp (ms) when the lock was created. */
  lockedAt: number;
  /** ISO timestamp (ms) when the lock was released. */
  unlockedAt?: number;
  /** Who/what unlocked it. */
  unlockedBy?: string;
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface LpSettlementStore {
  settlementOrders: Map<string, SettlementOrder>;
  lockedStablecoins: Map<string, LockedStablecoin>;
}

function createStore(): LpSettlementStore {
  return {
    settlementOrders: new Map(),
    lockedStablecoins: new Map(),
  };
}

const globalForLpSettlement = globalThis as unknown as {
  __PAYSWAP_LP_SETTLEMENT_STORE__?: LpSettlementStore;
  __PAYSWAP_LP_SETTLEMENT_SEEDED__?: boolean;
};

export const store: LpSettlementStore =
  globalForLpSettlement.__PAYSWAP_LP_SETTLEMENT_STORE__ ?? createStore();

if (!globalForLpSettlement.__PAYSWAP_LP_SETTLEMENT_STORE__) {
  globalForLpSettlement.__PAYSWAP_LP_SETTLEMENT_STORE__ = store;
}

// ─── Seed ─────────────────────────────────────────────────────────────────
//
// Seed the store with a handful of pending settlement orders and a couple
// of locked-stablecoin rows so the LP settlements page has content out of
// the box. Real orders/locks would be created by the runtime's settlement
// orchestrator when it can't auto-route a payment.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoIn(msFromNow: number): number {
  return Date.now() + msFromNow;
}

function isoAgo(msAgo: number): number {
  return Date.now() - msAgo;
}

export function seedLpSettlementStore(): void {
  if (globalForLpSettlement.__PAYSWAP_LP_SETTLEMENT_SEEDED__) return;
  globalForLpSettlement.__PAYSWAP_LP_SETTLEMENT_SEEDED__ = true;

  const corridors: Array<[string, string, string]> = [
    ['GHS→KES', 'GHS', 'KES'],
    ['KES→GHS', 'KES', 'GHS'],
    ['NGN→KES', 'NGN', 'KES'],
    ['GHS→NGN', 'GHS', 'NGN'],
    ['KES→UGX', 'KES', 'UGX'],
  ];

  // 6 pending settlement orders + 2 already matched + 1 settled
  const orders: SettlementOrder[] = [
    {
      id: uid('so'),
      corridor: corridors[0][0],
      sourceCurrency: corridors[0][1],
      destinationCurrency: corridors[0][2],
      amount: 4500,
      feeBps: 65,
      status: 'pending',
      reason: 'No LP bandwidth available in corridor — needs manual claim',
      paymentReference: 'pay_abc123',
      createdAt: isoAgo(2 * HOUR),
      deadlineAt: isoIn(22 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[1][0],
      sourceCurrency: corridors[1][1],
      destinationCurrency: corridors[1][2],
      amount: 12000,
      feeBps: 50,
      status: 'pending',
      reason: 'Existing LPs hit capacity ceiling for this hour',
      paymentReference: 'pay_def456',
      createdAt: isoAgo(45 * 60 * 1000),
      deadlineAt: isoIn(23 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[2][0],
      sourceCurrency: corridors[2][1],
      destinationCurrency: corridors[2][2],
      amount: 85000,
      feeBps: 80,
      status: 'pending',
      reason: 'New corridor — no active LP coverage yet',
      paymentReference: 'pay_ghi789',
      createdAt: isoAgo(15 * 60 * 1000),
      deadlineAt: isoIn(47 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[3][0],
      sourceCurrency: corridors[3][1],
      destinationCurrency: corridors[3][2],
      amount: 2300,
      feeBps: 55,
      status: 'pending',
      reason: 'LP schedules paused for compliance review',
      paymentReference: 'pay_jkl012',
      createdAt: isoAgo(4 * HOUR),
      deadlineAt: isoIn(20 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[4][0],
      sourceCurrency: corridors[4][1],
      destinationCurrency: corridors[4][2],
      amount: 18750,
      feeBps: 70,
      status: 'pending',
      reason: 'Settlement window missed — re-queued for LP claim',
      paymentReference: 'pay_mno345',
      createdAt: isoAgo(30 * 60 * 1000),
      deadlineAt: isoIn(6 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[0][0],
      sourceCurrency: corridors[0][1],
      destinationCurrency: corridors[0][2],
      amount: 980,
      feeBps: 90,
      status: 'pending',
      reason: 'Low-amount route skipped by automated router',
      paymentReference: 'pay_pqr678',
      createdAt: isoAgo(90 * 60 * 1000),
      deadlineAt: isoIn(10 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[1][0],
      sourceCurrency: corridors[1][1],
      destinationCurrency: corridors[1][2],
      amount: 6400,
      feeBps: 50,
      status: 'matched',
      reason: 'LP claimed this order — settlement in flight',
      paymentReference: 'pay_stu901',
      createdAt: isoAgo(6 * HOUR),
      deadlineAt: isoAgo(2 * HOUR),
      claimedByLpId: 'seed-lp-1',
      claimedAt: isoAgo(3 * HOUR),
    },
    {
      id: uid('so'),
      corridor: corridors[3][0],
      sourceCurrency: corridors[3][1],
      destinationCurrency: corridors[3][2],
      amount: 3100,
      feeBps: 55,
      status: 'settled',
      reason: 'Settled via LP bandwidth',
      paymentReference: 'pay_vwx234',
      createdAt: isoAgo(26 * HOUR),
      deadlineAt: isoAgo(2 * HOUR),
      claimedByLpId: 'seed-lp-1',
      claimedAt: isoAgo(20 * HOUR),
      settledAt: isoAgo(19 * HOUR),
    },
  ];
  for (const o of orders) store.settlementOrders.set(o.id, o);

  // 3 locked stablecoins — 2 still locked, 1 already unlocked
  const locks: LockedStablecoin[] = [
    {
      id: uid('ls'),
      lpId: 'seed-lp-1',
      amount: 5000,
      currency: 'USD',
      reason: 'Transfer did not complete within timeout window',
      transferReference: 'xfer_001',
      status: 'locked',
      lockedAt: isoAgo(3 * HOUR),
    },
    {
      id: uid('ls'),
      lpId: 'seed-lp-1',
      amount: 12500,
      currency: 'GHS',
      reason: 'Destination rail rejected — funds held pending retry',
      transferReference: 'xfer_002',
      status: 'locked',
      lockedAt: isoAgo(8 * HOUR),
    },
    {
      id: uid('ls'),
      lpId: 'seed-lp-2',
      amount: 2200,
      currency: 'KES',
      reason: 'Compliance hold released — unlock available',
      transferReference: 'xfer_003',
      status: 'locked',
      lockedAt: isoAgo(2 * DAY),
    },
    {
      id: uid('ls'),
      lpId: 'seed-lp-1',
      amount: 800,
      currency: 'USD',
      reason: 'Manual unlock after dispute resolved',
      transferReference: 'xfer_004',
      status: 'unlocked',
      lockedAt: isoAgo(5 * DAY),
      unlockedAt: isoAgo(4 * DAY),
      unlockedBy: 'lp-console',
    },
  ];
  for (const l of locks) store.lockedStablecoins.set(l.id, l);
}

// Auto-seed on first import (mirrors identity/store.ts pattern).
seedLpSettlementStore();

// ─── Service: Settlement orders ──────────────────────────────────────────────

export interface ListOrdersFilter {
  status?: SettlementOrderStatus;
  corridor?: string;
  lpId?: string;
}

export interface SettlementOrderService {
  list(filter?: ListOrdersFilter): SettlementOrder[];
  listPending(): SettlementOrder[];
  listMatchedByLp(lpId: string): SettlementOrder[];
  listSettledByLp(lpId: string): SettlementOrder[];
  get(id: string): SettlementOrder | null;
  claim(id: string, lpId: string): SettlementOrder | null;
  markSettled(id: string): SettlementOrder | null;
  create(input: Omit<SettlementOrder, 'id' | 'createdAt' | 'status'> & {
    status?: SettlementOrderStatus;
  }): SettlementOrder;
}

export const settlementOrderService: SettlementOrderService = {
  list(filter) {
    let rows = Array.from(store.settlementOrders.values());
    if (filter?.status) rows = rows.filter((o) => o.status === filter.status);
    if (filter?.corridor) rows = rows.filter((o) => o.corridor === filter.corridor);
    if (filter?.lpId) {
      rows = rows.filter(
        (o) =>
          o.claimedByLpId === filter.lpId ||
          (o.status === 'pending' && !o.claimedByLpId),
      );
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  listPending() {
    return Array.from(store.settlementOrders.values())
      .filter((o) => o.status === 'pending')
      .sort((a, b) => a.deadlineAt - b.deadlineAt);
  },

  listMatchedByLp(lpId: string) {
    return Array.from(store.settlementOrders.values())
      .filter((o) => o.claimedByLpId === lpId && o.status === 'matched')
      .sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0));
  },

  listSettledByLp(lpId: string) {
    return Array.from(store.settlementOrders.values())
      .filter((o) => o.claimedByLpId === lpId && o.status === 'settled')
      .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  },

  get(id: string) {
    return store.settlementOrders.get(id) ?? null;
  },

  claim(id: string, lpId: string) {
    const o = store.settlementOrders.get(id);
    if (!o) return null;
    if (o.status !== 'pending') return null;
    if (o.deadlineAt < Date.now()) {
      const expired: SettlementOrder = { ...o, status: 'expired' };
      store.settlementOrders.set(id, expired);
      return null;
    }
    const updated: SettlementOrder = {
      ...o,
      status: 'matched',
      claimedByLpId: lpId,
      claimedAt: Date.now(),
    };
    store.settlementOrders.set(id, updated);
    return updated;
  },

  markSettled(id: string) {
    const o = store.settlementOrders.get(id);
    if (!o) return null;
    const updated: SettlementOrder = {
      ...o,
      status: 'settled',
      settledAt: Date.now(),
    };
    store.settlementOrders.set(id, updated);
    return updated;
  },

  create(input) {
    const order: SettlementOrder = {
      id: uid('so'),
      createdAt: Date.now(),
      status: input.status ?? 'pending',
      ...input,
    };
    store.settlementOrders.set(order.id, order);
    return order;
  },
};

// ─── Service: Locked stablecoins ─────────────────────────────────────────────

export interface LockedStablecoinService {
  listByLp(lpId: string): LockedStablecoin[];
  list(filter?: { lpId?: string; status?: LockedStablecoinStatus }): LockedStablecoin[];
  get(id: string): LockedStablecoin | null;
  lock(input: Omit<LockedStablecoin, 'id' | 'lockedAt' | 'status'>): LockedStablecoin;
  unlock(id: string, unlockedBy: string): LockedStablecoin | null;
}

export const lockedStablecoinService: LockedStablecoinService = {
  listByLp(lpId) {
    return Array.from(store.lockedStablecoins.values())
      .filter((l) => l.lpId === lpId)
      .sort((a, b) => b.lockedAt - a.lockedAt);
  },

  list(filter) {
    let rows = Array.from(store.lockedStablecoins.values());
    if (filter?.lpId) rows = rows.filter((l) => l.lpId === filter.lpId);
    if (filter?.status) rows = rows.filter((l) => l.status === filter.status);
    return rows.sort((a, b) => b.lockedAt - a.lockedAt);
  },

  get(id) {
    return store.lockedStablecoins.get(id) ?? null;
  },

  lock(input) {
    const lock: LockedStablecoin = {
      id: uid('ls'),
      lockedAt: Date.now(),
      status: 'locked',
      ...input,
    };
    store.lockedStablecoins.set(lock.id, lock);
    return lock;
  },

  unlock(id, unlockedBy) {
    const l = store.lockedStablecoins.get(id);
    if (!l) return null;
    if (l.status !== 'locked') return null;
    const updated: LockedStablecoin = {
      ...l,
      status: 'unlocked',
      unlockedAt: Date.now(),
      unlockedBy,
    };
    store.lockedStablecoins.set(id, updated);
    return updated;
  },
};

// ─── Convenience overview (for LP dashboard KPIs) ────────────────────────────

export interface LpSettlementOverview {
  pendingOrders: number;
  pendingVolume: number;
  matchedByLp: number;
  settledByLp: number;
  lockedStablecoins: number;
  lockedAmountByCurrency: Record<string, number>;
}

export function overviewForLp(lpId: string): LpSettlementOverview {
  const pending = settlementOrderService.listPending();
  const matched = settlementOrderService.listMatchedByLp(lpId);
  const settled = settlementOrderService.listSettledByLp(lpId);
  const locks = lockedStablecoinService.listByLp(lpId).filter((l) => l.status === 'locked');
  const lockedAmountByCurrency: Record<string, number> = {};
  for (const l of locks) {
    lockedAmountByCurrency[l.currency] =
      (lockedAmountByCurrency[l.currency] ?? 0) + l.amount;
  }
  return {
    pendingOrders: pending.length,
    pendingVolume: pending.reduce((s, o) => s + o.amount, 0),
    matchedByLp: matched.length,
    settledByLp: settled.length,
    lockedStablecoins: locks.length,
    lockedAmountByCurrency,
  };
}
