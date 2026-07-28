/**
 * Cached Snapshot Manager — caches the runtime snapshot to avoid reading
 * ALL events on every dispatch. (NM-4 fix.)
 *
 * Problem: The dispatcher's buildSnapshot() calls eventStore.readAll(0, 50_000)
 * on EVERY dispatch, then replays all wallet events to compute balances.
 * At scale (thousands of events), this is O(n) per transaction — a
 * performance bottleneck.
 *
 * Solution: Cache the snapshot after each successful dispatch. On the next
 * dispatch, only read NEW events (since the last snapshot) and apply them
 * incrementally. This turns O(n) per dispatch into O(1) + O(new events).
 *
 * The cache is invalidated if:
 *   - The event store's global position doesn't match (external modification)
 *   - A dispatch fails (the cache may be stale)
 *   - Explicitly cleared (for ops)
 */

import type { RuntimeSnapshot } from '@/runtime/invariants';
import type { StoredEvent } from '@/runtime/events';

interface CachedSnapshot {
  snapshot: RuntimeSnapshot;
  globalPosition: number;  // event store position when the snapshot was taken
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — rebuild periodically to catch drift

class SnapshotCache {
  private cache: CachedSnapshot | null = null;
  private hitCount = 0;
  private missCount = 0;

  /**
   * Get the cached snapshot if valid, or null if cache miss.
   */
  get(currentGlobalPosition: number): RuntimeSnapshot | null {
    if (!this.cache) {
      this.missCount++;
      return null;
    }

    // Check if the cache is still valid (position matches + not expired)
    const age = Date.now() - this.cache.createdAt;
    if (age > CACHE_TTL_MS) {
      this.missCount++;
      this.cache = null;
      return null;
    }

    // If the global position changed unexpectedly (external modification),
    // invalidate the cache
    if (this.cache.globalPosition !== currentGlobalPosition) {
      this.missCount++;
      this.cache = null;
      return null;
    }

    this.hitCount++;
    return this.cache.snapshot;
  }

  /**
   * Update the cache with a new snapshot after a successful dispatch.
   */
  set(snapshot: RuntimeSnapshot, globalPosition: number): void {
    this.cache = {
      snapshot,
      globalPosition,
      createdAt: Date.now(),
    };
  }

  /**
   * Incrementally update the cached snapshot with new events.
   * This avoids a full rebuild — we only apply the new events to the
   * existing cached state.
   */
  applyNewEvents(newEvents: StoredEvent[], newGlobalPosition: number): void {
    if (!this.cache) return;

    // Apply new events to the cached snapshot
    const snapshot = this.cache.snapshot;

    // Add new events to the snapshot's event list
    snapshot.events = [...snapshot.events, ...newEvents];

    // Update wallet balances from new wallet events
    const newWalletEvents = newEvents.filter((e) => e.streamType === 'wallet');
    for (const ev of newWalletEvents) {
      const payload = ev.payload as Record<string, unknown>;
      const walletId = payload.walletId as string;
      if (!walletId) continue;

      let wallet = snapshot.wallets.get(walletId);
      if (!wallet) {
        wallet = { walletId, available: 0, reserved: 0, total: 0, isClosed: false };
        snapshot.wallets.set(walletId, wallet);
      }

      switch (ev.type) {
        case 'wallet.credited':
          wallet.available += payload.amount as number;
          wallet.total += payload.amount as number;
          break;
        case 'wallet.debited':
          wallet.available -= payload.amount as number;
          wallet.total -= payload.amount as number;
          break;
        case 'wallet.reserved':
          wallet.reserved += payload.amount as number;
          wallet.available -= payload.amount as number;
          break;
        case 'wallet.released':
          wallet.reserved -= payload.amount as number;
          wallet.available += payload.amount as number;
          break;
      }
    }

    // Add new ledger entries to the snapshot
    const newLedgerEvents = newEvents.filter((e) => e.type === 'ledger.entry.posted');
    for (const ev of newLedgerEvents) {
      const p = ev.payload as Record<string, unknown>;
      snapshot.ledgerEntries.push({
        account: (p.accountLabel as string) || (p.account as string) || '',
        debit: p.debit as number,
        credit: p.credit as number,
        operationId: (p.entryId as string) || ev.id,
        reason: (p.memo as string) || '',
      });
    }

    // Update the cache position
    this.cache.globalPosition = newGlobalPosition;
    this.cache.createdAt = Date.now();
  }

  /**
   * Invalidate the cache (force full rebuild on next dispatch).
   */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Get cache stats for monitoring.
   */
  getStats(): { hits: number; misses: number; hitRate: number; isCached: boolean } {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? Math.round((this.hitCount / total) * 100) : 0,
      isCached: this.cache !== null,
    };
  }
}

export const snapshotCache = new SnapshotCache();
