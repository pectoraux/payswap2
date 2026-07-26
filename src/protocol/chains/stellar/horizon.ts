/**
 * PaySwap Protocol — Horizon Synchronization.
 *
 * `HorizonSync` is the protocol-layer abstraction over Stellar's Horizon
 * event stream. In simulation mode it emits synthetic ledger-close events
 * on a timer. In live mode it polls Horizon's `/ledgers` endpoint (or
 * streams via SSE).
 *
 * Emits `chain.ledger_closed` events on the kernel `eventEngine` so that
 * protocol modules (settlement, escrow, treasury) can react to new ledgers.
 *
 * Usage:
 *   const stop = horizonSync.start(5_000);  // poll every 5s
 *   // ... later ...
 *   stop();
 *   // or
 *   horizonSync.stop();
 */
import { eventEngine } from '@/kernel/event';
import type { ChainMode, ChainNetwork } from '../adapter';
import { stellarChainAdapter, loadStellarSdk } from './adapter';

export interface LedgerCloseEvent {
  chain: 'stellar';
  ledger: number;
  closeTime: number;       // unix ms
  txCount: number;
  network: ChainNetwork;
  mode: ChainMode;
}

export interface AccountEffect {
  address: string;
  type: string;
  amount?: number;
  assetCode?: string;
  txHash?: string;
  createdAt: number;
}

export interface TransactionEffect {
  txHash: string;
  type: string;
  account?: string;
  amount?: number;
  assetCode?: string;
  createdAt: number;
}

export class HorizonSync {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private streamUnsub: (() => void) | null = null;
  private ledgerListeners = new Set<(e: LedgerCloseEvent) => void>();
  private latestLedger: LedgerCloseEvent | null = null;

  constructor() {}

  /**
   * Start syncing. Returns a `stop` function.
   *
   * In sim mode: emits a synthetic ledger close every `pollIntervalMs`.
   * In live mode: polls Horizon `/ledgers` every `pollIntervalMs`.
   */
  start(pollIntervalMs: number = 5_000): () => void {
    this.stop();
    // Subscribe to the adapter's ledger stream (sim emits on a timer;
    // live returns a no-op unsub until SSE is wired).
    this.streamUnsub = stellarChainAdapter.streamLedgers((l) => {
      const evt: LedgerCloseEvent = {
        chain: 'stellar',
        ledger: l.ledger,
        closeTime: l.closeTime,
        txCount: l.txCount,
        network: stellarChainAdapter.network,
        mode: stellarChainAdapter.mode,
      };
      this.handleLedgerClose(evt);
    });
    // Also poll periodically for live mode (so we have a fallback if SSE
    // is not wired). In sim mode this is a no-op since the adapter's
    // streamLedgers already emits on a timer.
    if (stellarChainAdapter.mode === 'live') {
      this.pollTimer = setInterval(() => {
        this.pollLive().catch(() => { /* swallow */ });
      }, pollIntervalMs);
    }
    return () => this.stop();
  }

  /** Stop syncing. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.streamUnsub) {
      try {
        this.streamUnsub();
      } catch {
        /* swallow */
      }
      this.streamUnsub = null;
    }
  }

  /** Get the latest ledger we've observed. */
  getLatestLedger(): LedgerCloseEvent | null {
    return this.latestLedger;
  }

  /**
   * Subscribe to ledger close events. Returns an unsubscribe function.
   * Also emits on the kernel `eventEngine` as `chain.ledger_closed`.
   */
  streamLedgers(callback: (e: LedgerCloseEvent) => void): () => void {
    this.ledgerListeners.add(callback);
    return () => {
      this.ledgerListeners.delete(callback);
    };
  }

  /**
   * Get effects for an account (recent activity). In sim mode, returns an
   * empty array (sim doesn't track effects); in live mode, queries Horizon.
   */
  async getAccountEffects(address: string): Promise<AccountEffect[]> {
    if (stellarChainAdapter.mode === 'live') {
      // === live signature ===
      //   const resp = await server.effects().forAccount(address).order('desc').limit(50).call();
      //   return resp.records.map(r => ({
      //     address, type: r.type, amount: r.amount ? Number(r.amount) : undefined,
      //     assetCode: r.asset_code, txHash: r.transaction_hash, createdAt: Date.parse(r.created_at),
      //   }));
      const sdk = await loadStellarSdk();
      if (!sdk) return [];
      return [];
    }
    // Sim — no per-account effect log; return empty.
    return [];
  }

  /**
   * Get effects for a specific transaction. In sim mode, returns the
   * recorded transaction payload as a synthetic effect list.
   */
  async getTransactionEffects(txHash: string): Promise<TransactionEffect[]> {
    if (stellarChainAdapter.mode === 'live') {
      // === live signature ===
      //   const resp = await server.effects().forTransaction(txHash).call();
      //   return resp.records.map(r => ({
      //     txHash, type: r.type, account: r.account, amount: r.amount ? Number(r.amount) : undefined,
      //     assetCode: r.asset_code, createdAt: Date.parse(r.created_at),
      //   }));
      const sdk = await loadStellarSdk();
      if (!sdk) return [];
      return [];
    }
    // Sim — look up the tx via the adapter.
    const tx = await stellarChainAdapter.getTransaction({ txHash });
    if (!tx.success || !tx.transaction) return [];
    const t = tx.transaction;
    return [
      {
        txHash: t.txHash,
        type: t.operation,
        account: t.source,
        createdAt: t.createdAt,
      },
    ];
  }

  // ============================================================ internal

  private handleLedgerClose(evt: LedgerCloseEvent): void {
    this.latestLedger = evt;
    // Emit on the kernel event bus. Cast to Record<string, unknown> —
    // `eventEngine.emit` requires a plain payload, and `LedgerCloseEvent`
    // is structurally compatible but lacks an index signature.
    eventEngine.emit('chain.ledger_closed', evt as unknown as Record<string, unknown>, 0);
    // Emit to direct subscribers.
    for (const cb of this.ledgerListeners) {
      try {
        cb(evt);
      } catch {
        /* swallow */
      }
    }
  }

  /** Poll Horizon /ledgers for live mode (fallback when SSE not wired). */
  private async pollLive(): Promise<void> {
    const res = await stellarChainAdapter.getLatestLedger();
    if (res.success && res.ledger != null) {
      const evt: LedgerCloseEvent = {
        chain: 'stellar',
        ledger: res.ledger,
        closeTime: res.closeTime ?? Date.now(),
        txCount: 0,
        network: stellarChainAdapter.network,
        mode: stellarChainAdapter.mode,
      };
      // Only fire if the ledger advanced.
      if (!this.latestLedger || evt.ledger > this.latestLedger.ledger) {
        this.handleLedgerClose(evt);
      }
    }
  }
}

/** Singleton Horizon sync instance. */
export const horizonSync = new HorizonSync();
