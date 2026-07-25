/**
 * Treasury v2 — Twin Token backing verification.
 *
 * The BackingVerifier checks that every Twin Token in circulation is fully
 * backed by treasury reserves. The invariant is:
 *
 *     circulating + escrowed ≤ reserve.available(currency)
 *
 * ( circulating = freely held tokens, escrowed = locked for settlement,
 *   both are liabilities the treasury must redeem on demand. )
 *
 * Backing ratio = reserve / (circulating + escrowed). Must be ≥ 1.0 for full
 * backing. If it drops below 1.0, a `treasury.backing_mismatch` event is
 * emitted and the verifier raises a `backing_mismatch` alert.
 *
 * The verifier exposes:
 *   - `verifyBacking(assetCode)` — single-asset verification
 *   - `verifyAll()` — checks every registered asset; returns array
 *   - `onMint(assetCode, amount)` — pre-mint hook: checks the reserve could
 *     back the new tokens. If not, returns false and emits
 *     `treasury.backing_insufficient`. The twin-token engine SHOULD honor this
 *     and abort the mint.
 *
 * The verifier never throws.
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { BackingVerification } from './types';
import { MIN_BACKING_RATIO } from './types';
import type { ReserveMonitor } from './reserve';

/**
 * BackingVerifier — verifies Twin Token backing against treasury reserves.
 */
export class BackingVerifier {
  /**
   * Verify backing for a single asset. Returns a `BackingVerification` with
   * `verified = true` if the reserve fully covers circulating + escrowed.
   *
   * If the asset is unknown to the twin-token engine, returns `verified = true`
   * with all-zero fields (no tokens = no liability = trivially backed).
   *
   * If the reserve is unknown, returns `verified = false` with discrepancy =
   * circulating + escrowed (the full liability is unbacked).
   */
  verifyBacking(
    assetCode: string,
    twinTokenEngine: TwinTokenEngine,
    reserveMonitor: ReserveMonitor,
  ): BackingVerification {
    const asset = twinTokenEngine.getAsset(assetCode);
    if (!asset) {
      return {
        verified: true,
        assetCode,
        circulating: 0,
        escrowed: 0,
        reserve: 0,
        backingRatio: 1,
        discrepancy: 0,
      };
    }
    const circulating = round(asset.circulating, 6);
    const escrowed = round(asset.escrowed, 6);
    const liabilities = round(circulating + escrowed, 6);
    const reserve = round(reserveMonitor.available(asset.currency), 6);
    const backingRatio = liabilities > 0 ? round(reserve / liabilities, 6) : 1;
    const discrepancy = round(liabilities - reserve, 6);
    const verified = backingRatio >= MIN_BACKING_RATIO;

    if (verified) {
      eventEngine.emit('treasury.backing_verified', {
        assetCode,
        circulating,
        escrowed,
        reserve,
        backingRatio,
      }, 0);
    } else {
      eventEngine.emit('treasury.backing_mismatch', {
        assetCode,
        circulating,
        escrowed,
        reserve,
        backingRatio,
        discrepancy,
      }, 0);
    }
    return { verified, assetCode, circulating, escrowed, reserve, backingRatio, discrepancy };
  }

  /**
   * Verify backing for every registered Twin Token asset. Returns an array of
   * `BackingVerification` results (one per asset).
   *
   * `allVerified` is true iff every asset is verified.
   */
  verifyAll(
    twinTokenEngine: TwinTokenEngine,
    reserveMonitor: ReserveMonitor,
  ): { allVerified: boolean; results: BackingVerification[] } {
    const assets = twinTokenEngine.allAssets();
    const results = assets.map((a) => this.verifyBacking(a.code, twinTokenEngine, reserveMonitor));
    const allVerified = results.every((r) => r.verified);
    return { allVerified, results };
  }

  /**
   * Pre-mint hook — checks the reserve can back `amount` new tokens of
   * `assetCode`. If the post-mint backing ratio would drop below 1.0, returns
   * false and emits `treasury.backing_insufficient`.
   *
   *   post-mint circulating = circulating + amount
   *   post-mint liabilities = (circulating + amount) + escrowed
   *   required reserve = post-mint liabilities
   *   if reserve.available < required reserve → blocked
   *
   * The twin-token engine SHOULD call this before minting and abort if false.
   */
  onMint(
    assetCode: string,
    amount: number,
    twinTokenEngine: TwinTokenEngine,
    reserveMonitor: ReserveMonitor,
  ): boolean {
    if (amount <= 0) return false;
    const asset = twinTokenEngine.getAsset(assetCode);
    if (!asset) {
      eventEngine.emit('treasury.backing_insufficient', {
        assetCode,
        amount,
        reason: 'asset_not_registered',
      }, 0);
      return false;
    }
    const postCirculating = round(asset.circulating + amount, 6);
    const liabilities = round(postCirculating + asset.escrowed, 6);
    const reserve = round(reserveMonitor.available(asset.currency), 6);

    if (reserve < liabilities) {
      eventEngine.emit('treasury.backing_insufficient', {
        assetCode,
        amount,
        currency: asset.currency,
        postCirculating,
        escrowed: asset.escrowed,
        liabilities,
        reserve,
        shortfall: round(liabilities - reserve, 6),
      }, 0);
      return false;
    }
    return true;
  }

  /**
   * Pre-burn hook — burns reduce liabilities, so they always improve backing
   * (or are neutral). The only check is that the asset exists. Returns true if
   * the burn can proceed.
   */
  onBurn(
    assetCode: string,
    amount: number,
    twinTokenEngine: TwinTokenEngine,
    _reserveMonitor: ReserveMonitor,
  ): boolean {
    if (amount <= 0) return false;
    const asset = twinTokenEngine.getAsset(assetCode);
    if (!asset) {
      eventEngine.emit('treasury.backing_insufficient', {
        assetCode,
        amount,
        reason: 'asset_not_registered',
      }, 0);
      return false;
    }
    return true;
  }
}

/** Singleton backing verifier. */
export const backingVerifier = new BackingVerifier();
