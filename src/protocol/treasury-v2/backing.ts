/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Stablecoin Backing.
 *
 * Verifies the 1:1 fiat-backing invariant for PaySwap's Twin Tokens
 * (`TWIN<CCY>`). Every `TWIN<CCY>` in circulation MUST be backed by
 * at least 1.0 of `<CCY>` in the treasury's available reserves.
 *
 * The verifier is the second gate in the `preMintHook` chain
 * (after the mint-limit check). If backing is insufficient, the
 * mint is blocked and a `treasury.backing_mismatch` event is
 * emitted with the discrepancy.
 *
 * The verifier maintains an in-memory projection of circulating
 * supply per asset. Callers update it via `onMint()` / `onBurn()`.
 * The actual on-chain circulating supply is the source of truth —
 * `syncSupplyFromChain()` is the production seam.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.backing_verified`   — successful verification.
 *  - `treasury.backing_mismatch`   — shortfall detected (with discrepancy).
 *  - `treasury.backing_blocked`    — a pre-mint hook blocked a mint.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { LimitCheckResult } from './types';

/** Per-asset backing state. */
export interface BackingState {
  assetCode: string;
  /** Circulating supply (minted - burned). */
  circulating: number;
  /** Portion of circulating supply locked in escrow (still backed). */
  escrowed: number;
  /** Last verification timestamp. */
  lastVerifiedTs: number;
  /** Last computed backing ratio (1.0 = fully backed). */
  lastBackingRatio: number;
}

/** The outcome of a backing verification. */
export interface BackingVerification {
  assetCode: string;
  verified: boolean;
  /** `reserveAvailable / circulating`. 1.0 = fully backed. */
  backingRatio: number;
  /** Positive = reserve shortfall; negative = excess; 0 = exact. */
  discrepancy: number;
  /** Required reserve (circulating). */
  required: number;
  /** Available reserve observed. */
  reserveAvailable: number;
  ts: number;
}

/** Input to `verifyAll()`. */
export interface BackingAssetInput {
  assetCode: string;
  circulating: number;
  escrowed: number;
  reserveAvailable: number;
}

/** A function that resolves the available reserve for an asset. */
export type ReserveResolver = (assetCode: string) => number;

/**
 * Backing verifier — owns the per-asset circulating supply projection
 * and verifies the 1:1 fiat-backing invariant.
 */
export class BackingVerifier {
  private states = new Map<string, BackingState>();
  /** Pluggable reserve resolver (defaults to a flat 0). */
  private reserveResolver: ReserveResolver = () => 0;
  /** Optional chain-sync adapter for circulating supply. */
  private supplySyncFn: ((assetCode: string) => Promise<{ circulating: number; escrowed: number } | null>) | null = null;
  /** Tolerance band (e.g. 0.999 means we accept down to 99.9% backing). */
  private tolerance: number;

  constructor(opts?: { tolerance?: number; reserveResolver?: ReserveResolver }) {
    this.tolerance = opts?.tolerance ?? 0.999;
    if (opts?.reserveResolver) this.reserveResolver = opts.reserveResolver;
  }

  /** Set the reserve resolver (production wiring seam). */
  setReserveResolver(fn: ReserveResolver): void {
    this.reserveResolver = fn;
  }

  /** Set the supply-sync adapter (production wiring seam). */
  setSupplySyncFn(fn: (assetCode: string) => Promise<{ circulating: number; escrowed: number } | null>): void {
    this.supplySyncFn = fn;
  }

  /** Set the tolerance band (1 - max permissible shortfall fraction). */
  setTolerance(tolerance: number): void {
    this.tolerance = Math.max(0, Math.min(1, tolerance));
  }

  /** Initialise / override the circulating supply for an asset. */
  setSupply(assetCode: string, circulating: number, escrowed = 0): BackingState {
    const state: BackingState = {
      assetCode,
      circulating,
      escrowed,
      lastVerifiedTs: nowTs(),
      lastBackingRatio: 1.0,
    };
    this.states.set(assetCode, state);
    return state;
  }

  /** Get the backing state for an asset (or undefined). */
  get(assetCode: string): BackingState | undefined {
    return this.states.get(assetCode);
  }

  /** All tracked backing states. */
  all(): BackingState[] {
    return [...this.states.values()];
  }

  /**
   * Verify the 1:1 backing invariant for a single asset.
   *
   * `reserveAvailable` is the fiat reserve available to back the
   * stablecoin (e.g. GHS reserve for TWINGHS). If not provided,
   * the resolver is used.
   *
   * Returns a `BackingVerification` with the ratio, discrepancy,
   * and verification result. Emits `treasury.backing_verified`
   * (when verified) or `treasury.backing_mismatch` (when not).
   */
  verifyBacking(
    assetCode: string,
    circulating: number,
    escrowed: number,
    reserveAvailable?: number,
  ): BackingVerification {
    const reserve = reserveAvailable ?? this.reserveResolver(assetCode);
    const ratio = circulating <= 0 ? 1.0 : reserve / circulating;
    const discrepancy = circulating - reserve; // positive = shortfall
    const verified = ratio >= this.tolerance;

    // Update state.
    const state = this.states.get(assetCode);
    if (state) {
      state.circulating = circulating;
      state.escrowed = escrowed;
      state.lastVerifiedTs = nowTs();
      state.lastBackingRatio = ratio;
    } else {
      this.states.set(assetCode, {
        assetCode,
        circulating,
        escrowed,
        lastVerifiedTs: nowTs(),
        lastBackingRatio: ratio,
      });
    }

    const result: BackingVerification = {
      assetCode,
      verified,
      backingRatio: ratio,
      discrepancy,
      required: circulating,
      reserveAvailable: reserve,
      ts: nowTs(),
    };

    if (verified) {
      eventEngine.emit('treasury.backing_verified', {
        assetCode,
        backingRatio: ratio,
        circulating,
        reserveAvailable: reserve,
      });
    } else {
      eventEngine.emit('treasury.backing_mismatch', {
        assetCode,
        backingRatio: ratio,
        circulating,
        reserveAvailable: reserve,
        discrepancy,
        shortfall: Math.max(0, discrepancy),
      });
    }
    return result;
  }

  /**
   * Verify backing for all assets in one call. Returns the per-asset
   * verifications + an overall flag (true iff every asset verified).
   */
  verifyAll(assets: BackingAssetInput[]): {
    overall: boolean;
    results: BackingVerification[];
  } {
    const results = assets.map((a) =>
      this.verifyBacking(a.assetCode, a.circulating, a.escrowed, a.reserveAvailable),
    );
    const overall = results.every((r) => r.verified);
    return { overall, results };
  }

  /**
   * Pre-mint hook: check whether minting `amount` of `assetCode`
   * would still leave the backing invariant satisfied. Returns a
   * `LimitCheckResult`-shaped result — `allowed: false` blocks the
   * mint with a `reason`.
   *
   * The check uses the *current* circulating supply + the proposed
   * mint amount against the *current* available reserve.
   */
  onMint(assetCode: string, amount: number): LimitCheckResult {
    if (amount <= 0) {
      return { allowed: false, reason: 'non_positive_amount' };
    }
    const state = this.states.get(assetCode);
    const circulating = (state?.circulating ?? 0) + amount;
    const escrowed = state?.escrowed ?? 0;
    const reserve = this.reserveResolver(assetCode);
    const ratio = reserve / circulating;

    if (ratio < this.tolerance) {
      const shortfall = circulating - reserve;
      eventEngine.emit('treasury.backing_blocked', {
        assetCode,
        amount,
        reason: 'insufficient_backing',
        backingRatio: ratio,
        shortfall,
        circulating,
        reserveAvailable: reserve,
      });
      return {
        allowed: false,
        reason: `insufficient_backing:ratio=${ratio.toFixed(4)}<${this.tolerance}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Record a successful mint against the backing state (updates
   * circulating supply). Called by the treasury engine after both
   * the limit check AND the backing check pass and the mint
   * actually executes.
   */
  recordMint(assetCode: string, amount: number): void {
    const state = this.states.get(assetCode) ?? {
      assetCode,
      circulating: 0,
      escrowed: 0,
      lastVerifiedTs: nowTs(),
      lastBackingRatio: 1.0,
    };
    state.circulating += amount;
    state.lastVerifiedTs = nowTs();
    this.states.set(assetCode, state);
  }

  /** Record a successful burn (reduces circulating supply). */
  recordBurn(assetCode: string, amount: number): void {
    const state = this.states.get(assetCode);
    if (!state) return;
    state.circulating = Math.max(0, state.circulating - amount);
    state.lastVerifiedTs = nowTs();
  }

  /** Record an escrow (moves circulating → escrowed; total unchanged). */
  recordEscrow(assetCode: string, amount: number): void {
    const state = this.states.get(assetCode);
    if (!state) return;
    state.escrowed = Math.min(state.circulating, state.escrowed + amount);
  }

  /** Release an escrow (moves escrowed → circulating). */
  releaseEscrow(assetCode: string, amount: number): void {
    const state = this.states.get(assetCode);
    if (!state) return;
    state.escrowed = Math.max(0, state.escrowed - amount);
  }

  /**
   * Sync circulating supply from chain. Production wires up
   * `setSupplySyncFn()` to query the Stellar horizon adapter for
   * the actual on-chain supply of each TWIN token.
   */
  async syncSupplyFromChain(assetCode?: string): Promise<BackingState[]> {
    const updated: BackingState[] = [];
    const codes = assetCode ? [assetCode] : [...this.states.keys()];
    for (const code of codes) {
      if (this.supplySyncFn) {
        const fresh = await this.supplySyncFn(code);
        if (fresh) {
          this.setSupply(code, fresh.circulating, fresh.escrowed);
          updated.push(this.states.get(code)!);
          continue;
        }
      }
      const state = this.states.get(code);
      if (state) {
        state.lastVerifiedTs = nowTs();
        updated.push(state);
      }
    }
    return updated;
  }

  /** Reset all backing state. */
  reset(): void {
    this.states.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_BACKING_VERIFIER: BackingVerifier | undefined;
}

export const backingVerifier: BackingVerifier =
  globalThis.__PAYSWAP_BACKING_VERIFIER ?? new BackingVerifier();

if (!globalThis.__PAYSWAP_BACKING_VERIFIER) {
  globalThis.__PAYSWAP_BACKING_VERIFIER = backingVerifier;
}
