/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Reserve Monitor.
 *
 * Real-time monitoring of per-currency reserves. The ReserveMonitor is
 * the canonical source of truth for "how much GHS / KES / USD do we
 * have right now, and how much is available (not reserved for
 * in-flight settlements)?".
 *
 * The monitor is intentionally simple — it is an in-memory projection
 * of the treasury's reserve accounts. The `syncFromChain()` hook is
 * the seam where a real implementation would pull on-chain balances
 * (Stellar trustline balances, bank API balances, custodian balances)
 * and reconcile them against the local view. The default
 * implementation is a no-op that returns the current local state —
 * production wires up the chain/bank/custodian adapters here.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.reserve_set`         — when a reserve is set/updated.
 *  - `treasury.reserve_low`         — when a reserve drops below threshold.
 *  - `treasury.reserve_reconciled`  — after `syncFromChain()` completes.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { ReserveAccount, TreasuryAlert } from './types';

/** A low-reserve alert payload. */
export interface ReserveLowAlert {
  currency: string;
  balance: number;
  available: number;
  threshold: number;
  ts: number;
}

/**
 * Reserve monitor — owns the in-memory projection of all reserve
 * accounts. Thread-unsafe by design (single-threaded JS event loop).
 */
export class ReserveMonitor {
  private reserves = new Map<string, ReserveAccount>();
  /** Per-currency alert thresholds (fraction of `balance`). */
  private thresholds = new Map<string, number>();
  private defaultThreshold = 0.20;
  /** Optional chain-sync adapter (production wires this up). */
  private chainSyncFn: ((currency: string) => Promise<{ balance: number; reserved: number } | null>) | null = null;
  /** Optional twin-token engine reference (for live backing-ratio computation). */
  private twinTokenEngine: {
    getAsset(code: string): { circulating?: number; escrowed?: number; totalSupply?: number } | undefined;
  } | null = null;

  /** Default low-reserve threshold (fraction). */
  setDefaultThreshold(fraction: number): void {
    this.defaultThreshold = Math.max(0, Math.min(1, fraction));
  }

  /** Set a per-currency alert threshold. */
  setThreshold(currency: string, fraction: number): void {
    this.thresholds.set(currency, Math.max(0, Math.min(1, fraction)));
  }

  /** Set the chain-sync adapter (production wiring seam). */
  setChainSyncFn(fn: (currency: string) => Promise<{ balance: number; reserved: number } | null>): void {
    this.chainSyncFn = fn;
  }

  /**
   * Set/update a reserve account.
   *
   * `reserved` defaults to 0; `available` is computed as
   * `balance - reserved`. The `backingRatio` is preserved if it
   * was previously set and not provided here (callers update it
   * via `BackingVerifier`).
   */
  setReserve(currency: string, balance: number, reserved = 0, opts?: { backingRatio?: number }): ReserveAccount {
    const prev = this.reserves.get(currency);
    const available = Math.max(0, balance - reserved);
    const backingRatio = opts?.backingRatio ?? prev?.backingRatio ?? 1.0;
    const account: ReserveAccount = {
      currency,
      assetCode: `TWIN${currency}`,  // mirror the TWIN<CCY> convention
      balance,
      reserved,
      available,
      lastReconciledTs: nowTs(),
      backingRatio,
    };
    this.reserves.set(currency, account);

    eventEngine.emit('treasury.reserve_set', {
      currency,
      balance,
      reserved,
      available,
      backingRatio,
    });

    // Auto-alert if below threshold.
    const threshold = this.thresholds.get(currency) ?? this.defaultThreshold;
    if (account.balance > 0 && account.available / Math.max(1, account.balance) < threshold) {
      eventEngine.emit('treasury.reserve_low', {
        currency,
        balance: account.balance,
        available: account.available,
        threshold,
        ts: nowTs(),
      } satisfies ReserveLowAlert);
    }

    return account;
  }

  /** Get a reserve account (returns undefined if not tracked). */
  getReserve(currency: string): ReserveAccount | undefined {
    return this.reserves.get(currency);
  }

  /** Snapshot of all reserve accounts. */
  allReserves(): ReserveAccount[] {
    return [...this.reserves.values()];
  }

  /** Available (free) balance for a currency. Returns 0 if untracked. */
  available(currency: string): number {
    return this.reserves.get(currency)?.available ?? 0;
  }

  /** Gross balance for a currency. Returns 0 if untracked. */
  balance(currency: string): number {
    return this.reserves.get(currency)?.balance ?? 0;
  }

  /** Reserved (committed) balance for a currency. Returns 0 if untracked. */
  reserved(currency: string): number {
    return this.reserves.get(currency)?.reserved ?? 0;
  }

  /**
   * Compute the backing ratio for a stablecoin.
   *
   * `reserveAvailable` is the available fiat reserve backing the
   * stablecoin; `circulating` is the on-chain circulating supply;
   * `escrowed` is the portion of the supply already locked in
   * escrow (those are still backed, just committed).
   *
   * The ratio is `reserveAvailable / circulating`. A ratio >= 1.0
   * means fully backed.
   */
  backingRatio(assetCode: string, circulating: number, escrowed: number, reserveAvailable: number): number {
    if (circulating <= 0) return 1.0;
    const ratio = reserveAvailable / circulating;
    // Update the backingRatio on the underlying currency if we can
    // infer it (TWIN<CCY> → CCY reserve). The asset code is
    // conventionally `TWIN<CCY>` (e.g. `TWINGHS` → `GHS`).
    const currency = assetCode.startsWith('TWIN') ? assetCode.slice(4) : assetCode;
    const account = this.reserves.get(currency);
    if (account) {
      account.backingRatio = ratio;
    }
    // escrowed is informational; we don't subtract it from the
    // required reserve (escrowed tokens are still backed).
    void escrowed;
    return ratio;
  }

  /**
   * Sync a single currency's reserve from the chain/bank/custodian.
   *
   * The default implementation is a no-op (returns the current
   * local state). Production wires up `setChainSyncFn()` to call
   * the appropriate adapters (Stellar horizon for TWIN tokens,
   * bank APIs for fiat, Fireblocks for custody).
   */
  async syncFromChain(currency?: string): Promise<ReserveAccount[]> {
    const updated: ReserveAccount[] = [];
    const currencies = currency ? [currency] : [...this.reserves.keys()];
    for (const cur of currencies) {
      if (this.chainSyncFn) {
        const fresh = await this.chainSyncFn(cur);
        if (fresh) {
          updated.push(this.setReserve(cur, fresh.balance, fresh.reserved));
          continue;
        }
      }
      // No chain sync wired up — just bump the reconcile timestamp.
      const account = this.reserves.get(cur);
      if (account) {
        account.lastReconciledTs = nowTs();
        updated.push(account);
      }
    }
    eventEngine.emit('treasury.reserve_reconciled', {
      currencies: currencies,
      ts: nowTs(),
    });
    return updated;
  }

  /**
   * Check whether a currency's reserve is below its alert threshold.
   * Emits a `treasury.reserve_low` event if so. Returns the alert
   * (or null if no alert).
   */
  alertIfLow(currency: string, threshold?: number): TreasuryAlert | null {
    const account = this.reserves.get(currency);
    if (!account || account.balance <= 0) return null;
    const frac = threshold ?? this.thresholds.get(currency) ?? this.defaultThreshold;
    const actualFrac = account.available / Math.max(1, account.balance);
    if (actualFrac >= frac) return null;
    const alert: TreasuryAlert = {
      id: uid('talert'),
      level: actualFrac < frac / 2 ? 'critical' : 'warning',
      category: 'reserve',
      message: `Reserve ${currency} low: ${account.available} available (${(actualFrac * 100).toFixed(1)}% of ${account.balance})`,
      ts: nowTs(),
      subject: currency,
    };
    eventEngine.emit('treasury.reserve_low', {
      currency,
      balance: account.balance,
      available: account.available,
      threshold: frac,
      ts: alert.ts,
      alertId: alert.id,
    } satisfies ReserveLowAlert & { alertId: string });
    return alert;
  }

  /** Scan all reserves and return any low-reserve alerts. */
  scanForLowReserves(): TreasuryAlert[] {
    const out: TreasuryAlert[] = [];
    for (const currency of this.reserves.keys()) {
      const alert = this.alertIfLow(currency);
      if (alert) out.push(alert);
    }
    return out;
  }

  /**
   * Reserve (commit) a portion of a currency's balance for an
   * in-flight settlement. Reduces `available`, increases `reserved`.
   * Returns false if insufficient available balance.
   */
  reserveFunds(currency: string, amount: number): boolean {
    const account = this.reserves.get(currency);
    if (!account || account.available < amount) return false;
    account.available -= amount;
    account.reserved += amount;
    account.lastReconciledTs = nowTs();
    return true;
  }

  /** Release previously-reserved funds back to available. */
  releaseFunds(currency: string, amount: number): boolean {
    const account = this.reserves.get(currency);
    if (!account || account.reserved < amount) return false;
    account.reserved -= amount;
    account.available += amount;
    account.lastReconciledTs = nowTs();
    return true;
  }

  /** Debit (spend) reserved funds once a settlement completes. */
  debitReserved(currency: string, amount: number): boolean {
    const account = this.reserves.get(currency);
    if (!account || account.reserved < amount) return false;
    account.reserved -= amount;
    account.balance -= amount;
    account.lastReconciledTs = nowTs();
    return true;
  }

  /** Credit (top up) a reserve. */
  credit(currency: string, amount: number): void {
    const account = this.reserves.get(currency);
    if (!account) {
      this.setReserve(currency, amount, 0);
      return;
    }
    account.balance += amount;
    account.available += amount;
    account.lastReconciledTs = nowTs();
  }

  /**
   * Re-compute the backing ratio for every tracked reserve. Called after
   * twin-token supply changes (mint/burn/escrow) so the cached
   * `backingRatio` field reflects the current liability picture.
   *
   * If a TwinTokenEngine is bound (via `bindTwinTokenEngine`), the ratio
   * is computed live from the engine's circulating/escrowed numbers.
   * Otherwise the existing `backingRatio` is preserved (the verifier
   * recomputes it independently when called).
   */
  refreshBackingRatios(): void {
    for (const account of this.reserves.values()) {
      if (this.twinTokenEngine) {
        const assetCode = account.assetCode ?? `TWIN${account.currency}`;
        const asset = this.twinTokenEngine.getAsset(assetCode) as
          | { circulating?: number; escrowed?: number; totalSupply?: number }
          | undefined;
        const circulating = asset?.circulating ?? asset?.totalSupply ?? 0;
        if (circulating > 0) {
          account.backingRatio = account.available / circulating;
        } else {
          account.backingRatio = 1.0;
        }
      }
      account.lastReconciledTs = nowTs();
    }
  }

  /**
   * Bind a Twin Token engine so `refreshBackingRatios` can read live
   * circulating/escrowed numbers without a separate sync call.
   */
  bindTwinTokenEngine(engine: {
    getAsset(code: string): { circulating?: number; escrowed?: number; totalSupply?: number } | undefined;
  }): void {
    this.twinTokenEngine = engine;
  }

  /** Reset all reserve state. Test helper. */
  reset(): void {
    this.reserves.clear();
    this.thresholds.clear();
    this.twinTokenEngine = null;
    this.chainSyncFn = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_RESERVE_MONITOR: ReserveMonitor | undefined;
}

export const reserveMonitor: ReserveMonitor =
  globalThis.__PAYSWAP_RESERVE_MONITOR ?? new ReserveMonitor();

if (!globalThis.__PAYSWAP_RESERVE_MONITOR) {
  globalThis.__PAYSWAP_RESERVE_MONITOR = reserveMonitor;
}
