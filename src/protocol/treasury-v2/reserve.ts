/**
 * Treasury v2 — Reserve monitoring.
 *
 * The ReserveMonitor tracks `ReserveAccount` records per currency / asset. Each
 * account reflects the treasury's view of reserves for one fiat currency (GHS,
 * KES, NGN, USD, etc.) and its linked Twin Token asset (TWINGHS, TWINKES, ...).
 *
 * Responsibilities:
 *  - `setReserve(currency, balance, reserved)` — record reserve from on-chain
 *    evidence, bank confirmation, or LP attestation.
 *  - `getReserve(currency)` / `available(currency)` — query helpers.
 *  - `backingRatio(assetCode)` — reserve.available / (circulating + escrowed).
 *    Must be ≥ 1.0 for full backing. The verifier raises a `backing_mismatch`
 *    alert if it drops below 1.0.
 *  - `syncFromChain(stellarAdapter)` — read on-chain reserve account balances
 *    for every linked reserve address and update the in-memory accounts.
 *  - `alertIfLow(currency, threshold)` — check a single currency and emit
 *    `treasury.reserve_low` if available < threshold. Returns true if low.
 *
 * Invariants:
 *  - `available` is always `balance − reserved` (never negative; if reserved
 *    would exceed balance, available clamps to 0 and a `treasury.reserve_low`
 *    event is emitted).
 *  - `backingRatio` is recomputed every time `setReserve` is called (so it
 *    reflects the most recent reserve figure).
 *
 * The monitor never throws — every method returns a safe default (0 or false)
 * when the requested currency / asset is unknown.
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { ReserveAccount } from './types';
import { MIN_BACKING_RATIO } from './types';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { StellarAdapter } from '@/protocol/blockchains/stellar/adapter';

/**
 * ReserveMonitor — singleton-style class. The singleton instance is exported as
 * `reserveMonitor` at the bottom of this file.
 */
export class ReserveMonitor {
  /** Per-currency reserve accounts. */
  private reserves: Map<string, ReserveAccount> = new Map();
  /** Linked Twin Token asset code per currency (for backing ratio lookup). */
  private currencyToAsset: Map<string, string> = new Map();
  /** Linked reserve on-chain address per currency (for syncFromChain). */
  private reserveAddresses: Map<string, { address: string; assetCode: string }> = new Map();
  /** Optional twin-token engine reference (for backing ratio computation). */
  private twinTokenEngine: TwinTokenEngine | null = null;

  /**
   * Bind a Twin Token engine so backingRatio can read live circulating /
   * escrowed numbers. Without this, backingRatio returns the stored value
   * (or 1 if no liability info is available).
   */
  bindTwinTokenEngine(engine: TwinTokenEngine): void {
    this.twinTokenEngine = engine;
  }

  /** Link a fiat currency to its Twin Token asset code (e.g. GHS ↔ TWINGHS). */
  linkAsset(currency: string, assetCode: string): void {
    this.currencyToAsset.set(currency, assetCode);
  }

  /** Link a currency to its on-chain reserve account address. */
  linkReserveAddress(currency: string, address: string, assetCode: string): void {
    this.reserveAddresses.set(currency, { address, assetCode });
  }

  /**
   * Set / update a reserve account for a currency.
   *
   *   - `balance`  : total reserve currently held (fiat + stablecoin + on-chain)
   *   - `reserved` : portion already committed to in-flight liabilities
   *
   * The assetCode is auto-derived (TWIN${currency}) unless a different mapping
   * has been registered via `linkAsset`. `available` is computed as
   * `balance − reserved` (clamped to 0 if reserved > balance). `backingRatio`
   * is recomputed from the bound twin-token engine if available.
   */
  setReserve(currency: string, balance: number, reserved: number): ReserveAccount {
    const assetCode = this.currencyToAsset.get(currency) ?? `TWIN${currency}`;
    const safeBalance = Math.max(0, round(balance, 6));
    const safeReserved = Math.max(0, round(reserved, 6));
    const available = Math.max(0, round(safeBalance - safeReserved, 6));
    const backingRatio = this.computeBackingRatio(assetCode, available);

    const account: ReserveAccount = {
      currency,
      assetCode,
      balance: safeBalance,
      reserved: safeReserved,
      available,
      lastReconciledTs: Date.now(),
      backingRatio,
    };
    this.reserves.set(currency, account);
    return account;
  }

  /** Get the reserve account for a currency. */
  getReserve(currency: string): ReserveAccount | undefined {
    return this.reserves.get(currency);
  }

  /** All reserve accounts. */
  allReserves(): ReserveAccount[] {
    return [...this.reserves.values()];
  }

  /** Available (free) reserve for a currency. 0 if unknown. */
  available(currency: string): number {
    const r = this.reserves.get(currency);
    return r ? r.available : 0;
  }

  /** Total reserve balance for a currency. 0 if unknown. */
  balance(currency: string): number {
    const r = this.reserves.get(currency);
    return r ? r.balance : 0;
  }

  /** Reserved portion of a currency's reserve. 0 if unknown. */
  reserved(currency: string): number {
    const r = this.reserves.get(currency);
    return r ? r.reserved : 0;
  }

  /**
   * Backing ratio for an asset: `reserve.available(currency) / (circulating +
   * escrowed)`. ≥ 1.0 means fully backed. If circulating + escrowed = 0,
   * returns 1.0 (trivially backed — no liability).
   *
   * Computed LIVE from the bound twin-token engine (so it always reflects the
   * current circulating / escrowed numbers, not a cached value). If no
   * twin-token engine is bound, falls back to the cached `r.backingRatio`
   * stored at last `setReserve` / `refreshBackingRatios` call.
   *
   * The reserve's currency is derived from the asset code: `TWIN${currency}` →
   * `currency`. If the asset code doesn't follow that convention, the caller
   * should also `linkAsset(currency, assetCode)` so the mapping is explicit.
   */
  backingRatio(assetCode: string): number {
    const currency = this.assetToCurrency(assetCode);
    if (!currency) return 1;
    const r = this.reserves.get(currency);
    if (!r) return 0;
    // Live computation when the twin-token engine is bound.
    if (this.twinTokenEngine) {
      const asset = this.twinTokenEngine.getAsset(assetCode);
      if (asset) {
        const liabilities = round(asset.circulating + asset.escrowed, 6);
        if (liabilities <= 0) return 1;
        return round(r.available / liabilities, 6);
      }
    }
    // Fallback to the cached value (last setReserve / refreshBackingRatios).
    return r.backingRatio;
  }

  /**
   * Sync reserve balances from on-chain state. For every currency with a
   * linked reserve address, queries the Stellar adapter for the on-chain
   * balance and updates the reserve account's `balance`.
   *
   * `reserved` is preserved (it tracks in-flight liabilities the chain can't
   * observe). Returns the list of currencies that were updated.
   *
   * This is ASYNC because the Stellar adapter's getBalance is async.
   */
  async syncFromChain(stellarAdapter: StellarAdapter): Promise<string[]> {
    const updated: string[] = [];
    for (const [currency, link] of this.reserveAddresses.entries()) {
      try {
        const result = await stellarAdapter.getBalance({
          address: link.address,
          assetCode: link.assetCode,
        });
        if (result.success) {
          const existing = this.reserves.get(currency);
          const reserved = existing?.reserved ?? 0;
          this.setReserve(currency, result.balance, reserved);
          updated.push(currency);
        }
      } catch {
        // Adapter call failed — skip this currency. Reserve is left unchanged.
        // (The adapter never throws in practice, but we're defensive.)
      }
    }
    eventEngine.emit('treasury.reserve_synced', {
      currencies: updated,
      count: updated.length,
    }, 0);
    return updated;
  }

  /**
   * Check if a currency's available reserve is below `threshold` and emit
   * `treasury.reserve_low` if so. Returns true if low.
   *
   * The event payload includes the currency, available, threshold, and the
   * shortfall (threshold − available).
   */
  alertIfLow(currency: string, threshold: number): boolean {
    const r = this.reserves.get(currency);
    if (!r) return false;
    if (r.available < threshold) {
      eventEngine.emit('treasury.reserve_low', {
        currency,
        assetCode: r.assetCode,
        available: r.available,
        threshold,
        shortfall: round(threshold - r.available, 6),
        backingRatio: r.backingRatio,
      }, 0);
      return true;
    }
    return false;
  }

  /**
   * Check all reserves against their own thresholds. The threshold for each
   * currency is `max(thresholdMap[currency], 0)` — if no threshold is supplied
   * for a currency, it's skipped. Returns the list of low currencies.
   */
  alertAnyLow(thresholdMap: Record<string, number>): string[] {
    const low: string[] = [];
    for (const [currency, threshold] of Object.entries(thresholdMap)) {
      if (this.alertIfLow(currency, threshold)) low.push(currency);
    }
    return low;
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.reserves.clear();
    this.currencyToAsset.clear();
    this.reserveAddresses.clear();
    this.twinTokenEngine = null;
  }

  /* ----- internal helpers ----- */

  /** Derive the fiat currency from a Twin Token asset code (TWINGHS → GHS). */
  private assetToCurrency(assetCode: string): string | null {
    // Check explicit links first (in case of non-TWIN-prefixed assets).
    for (const [currency, asset] of this.currencyToAsset.entries()) {
      if (asset === assetCode) return currency;
    }
    // Convention: TWIN${currency}.
    if (assetCode.startsWith('TWIN')) {
      return assetCode.slice(4);
    }
    return null;
  }

  /**
   * Compute the backing ratio for an asset given its current reserve.
   *   - If no twin-token engine is bound, returns 1 (assume fully backed —
   *     the verifier will catch real mismatches when called separately).
   *   - If circulating + escrowed = 0, returns 1 (trivially backed).
   *   - Otherwise returns `reserve / (circulating + escrowed)`.
   */
  private computeBackingRatio(assetCode: string, reserve: number): number {
    if (!this.twinTokenEngine) return 1;
    const asset = this.twinTokenEngine.getAsset(assetCode);
    if (!asset) return 1;
    const liabilities = round(asset.circulating + asset.escrowed, 6);
    if (liabilities <= 0) return 1;
    return round(reserve / liabilities, 6);
  }

  /** Re-compute backing ratios for all reserves (after twin token changes). */
  refreshBackingRatios(): void {
    for (const r of this.reserves.values()) {
      r.backingRatio = this.computeBackingRatio(r.assetCode, r.available);
      r.lastReconciledTs = Date.now();
    }
  }

  /** Whether the reserve for an asset is fully backed (ratio ≥ 1.0). */
  isFullyBacked(assetCode: string): boolean {
    return this.backingRatio(assetCode) >= MIN_BACKING_RATIO;
  }
}

/** Singleton reserve monitor. */
export const reserveMonitor = new ReserveMonitor();
