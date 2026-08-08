/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Mint/Burn Limits.
 *
 * Enforces hard caps on Twin Token issuance (mint) and redemption
 * (burn). Every mint goes through `checkMint()` before it is
 * recorded; the protocol's `preMintHook` calls this in order:
 *
 *   1. daily limit (24h rolling window)
 *   2. per-tx limit
 *   3. cooldown (mints only)
 *   4. (backing sufficiency is checked separately by BackingVerifier)
 *
 * Pre-configured defaults:
 *   - TWINGHS:  daily 100_000, per-tx 50_000, cooldown 0ms
 *   - TWINKES:  daily 200_000, per-tx 100_000, cooldown 0ms
 *
 * The 24h rolling window resets when `now - windowStartTs >= 24h`.
 * After reset, `dailyUsed` returns to 0 and `windowStartTs` advances
 * to `now`. The window is "rolling" in the sense that any recordMint
 * call first rolls the window forward if it has expired.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.mint_blocked`   — when a mint is denied (with reason).
 *  - `treasury.mint_recorded`  — when a mint is recorded against the limit.
 *  - `treasury.burn_blocked`   — when a burn is denied (with reason).
 *  - `treasury.burn_recorded`  — when a burn is recorded against the limit.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { BurnLimit, LimitCheckResult, MintLimit } from './types';

/** Configuration for a mint limit. */
export interface MintLimitConfig {
  dailyLimit: number;
  perTxLimit: number;
  cooldownMs?: number;
}

/** Configuration for a burn limit. */
export interface BurnLimitConfig {
  dailyLimit: number;
  perTxLimit: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default mint limits per asset code. */
export const DEFAULT_MINT_LIMITS: Record<string, MintLimitConfig> = {
  TWINGHS: { dailyLimit: 100_000, perTxLimit: 50_000, cooldownMs: 0 },
  TWINKES: { dailyLimit: 200_000, perTxLimit: 100_000, cooldownMs: 0 },
};

/** Default burn limits per asset code (mirrors mint defaults). */
export const DEFAULT_BURN_LIMITS: Record<string, BurnLimitConfig> = {
  TWINGHS: { dailyLimit: 100_000, perTxLimit: 50_000 },
  TWINKES: { dailyLimit: 200_000, perTxLimit: 100_000 },
};

/**
 * Mint limit engine — enforces per-asset daily + per-tx + cooldown
 * limits on Twin Token minting.
 */
export class MintLimitEngine {
  private limits = new Map<string, MintLimit>();

  /**
   * Configure (or reconfigure) the mint limit for an asset.
   *
   * Backward-compat: accepts either `(assetCode, config)` or a single
   * `({ assetCode, ...config })` object.
   */
  configure(assetCodeOrConfig: string | (MintLimitConfig & { assetCode: string }), config?: MintLimitConfig): MintLimit {
    const assetCode = typeof assetCodeOrConfig === 'string'
      ? assetCodeOrConfig
      : assetCodeOrConfig.assetCode;
    const cfg = typeof assetCodeOrConfig === 'string'
      ? (config ?? { dailyLimit: 0, perTxLimit: 0 })
      : assetCodeOrConfig;
    const existing = this.limits.get(assetCode);
    const limit: MintLimit = {
      assetCode,
      dailyLimit: cfg.dailyLimit,
      perTxLimit: cfg.perTxLimit,
      cooldownMs: cfg.cooldownMs ?? 0,
      dailyUsed: existing?.dailyUsed ?? 0,
      windowStartTs: existing?.windowStartTs ?? nowTs(),
      lastMintTs: existing?.lastMintTs ?? 0,
    };
    this.limits.set(assetCode, limit);
    return limit;
  }

  /** Get the current mint limit state for an asset (or undefined). */
  get(assetCode: string): MintLimit | undefined {
    return this.limits.get(assetCode);
  }

  /** All configured mint limits. */
  all(): MintLimit[] {
    return [...this.limits.values()];
  }

  /**
   * Roll the 24h window forward if it has expired. Mutates the
   * limit record in place.
   */
  private rollWindow(limit: MintLimit, now: number): void {
    if (now - limit.windowStartTs >= DAY_MS) {
      limit.windowStartTs = now;
      limit.dailyUsed = 0;
    }
  }

  /**
   * Check whether a mint of `amount` would be allowed under the
   * configured limits. Does NOT record the mint — call
   * `recordMint()` after the mint succeeds.
   *
   * Checks (in order):
   *   1. asset is configured (denies if not)
   *   2. amount > 0
   *   3. per-tx limit
   *   4. cooldown (mints only)
   *   5. daily limit (remaining headroom)
   */
  checkMint(assetCode: string, amount: number): LimitCheckResult {
    const limit = this.limits.get(assetCode);
    if (!limit) {
      return { allowed: false, reason: `no_mint_limit_configured:${assetCode}` };
    }
    if (amount <= 0) {
      return { allowed: false, reason: 'non_positive_amount', remainingDaily: Math.max(0, limit.dailyLimit - limit.dailyUsed) };
    }
    const now = nowTs();
    this.rollWindow(limit, now);
    const remainingDaily = Math.max(0, limit.dailyLimit - limit.dailyUsed);

    if (amount > limit.perTxLimit) {
      eventEngine.emit('treasury.mint_blocked', {
        assetCode, amount, reason: 'per_tx_exceeded',
        perTxLimit: limit.perTxLimit,
      });
      return {
        allowed: false,
        reason: 'per_tx_exceeded',
        remainingDaily,
      };
    }

    if (limit.cooldownMs > 0 && limit.lastMintTs > 0) {
      const elapsed = now - limit.lastMintTs;
      if (elapsed < limit.cooldownMs) {
        const nextAllowedTs = limit.lastMintTs + limit.cooldownMs;
        eventEngine.emit('treasury.mint_blocked', {
          assetCode, amount, reason: 'cooldown_active',
          nextAllowedTs, cooldownMs: limit.cooldownMs,
        });
        return {
          allowed: false,
          reason: `cooldown_active:${nextAllowedTs - now}ms_remaining`,
          remainingDaily,
          nextAllowedTs,
        };
      }
    }

    if (amount > remainingDaily) {
      eventEngine.emit('treasury.mint_blocked', {
        assetCode, amount, reason: 'daily_exceeded',
        dailyLimit: limit.dailyLimit, dailyUsed: limit.dailyUsed,
      });
      return {
        allowed: false,
        reason: 'daily_exceeded',
        remainingDaily,
      };
    }

    return { allowed: true, remainingDaily: remainingDaily - amount };
  }

  /**
   * Record a successful mint against the limit. The caller MUST
   * have called `checkMint()` first and confirmed `allowed === true`.
   *
   * This method DOES NOT re-enforce the per-tx limit or the cooldown —
   * those are intentional properties of the *check* path, not the
   * recording path. Recording a mint that was approved earlier (or
   * via a privileged code path that bypassed per-tx) should succeed.
   *
   * The DAILY limit IS still enforced as defence in depth against
   * silent overage. If the recorded amount would push `dailyUsed`
   * past `dailyLimit`, the method throws.
   */
  recordMint(assetCode: string, amount: number): MintLimit {
    const limit = this.limits.get(assetCode);
    if (!limit) {
      throw new Error(`no_mint_limit_configured:${assetCode}`);
    }
    const now = nowTs();
    this.rollWindow(limit, now);
    const remainingDaily = Math.max(0, limit.dailyLimit - limit.dailyUsed);
    if (amount > remainingDaily) {
      eventEngine.emit('treasury.mint_blocked', {
        assetCode, amount, reason: 'daily_exceeded',
        dailyLimit: limit.dailyLimit, dailyUsed: limit.dailyUsed,
      });
      throw new Error(`mint_blocked:daily_exceeded`);
    }
    limit.dailyUsed += amount;
    limit.lastMintTs = now;
    eventEngine.emit('treasury.mint_recorded', {
      assetCode, amount, dailyUsed: limit.dailyUsed,
      dailyLimit: limit.dailyLimit,
      windowStartTs: limit.windowStartTs,
    });
    return limit;
  }

  /** Remaining daily headroom for an asset (after rolling window). */
  remainingDaily(assetCode: string): number {
    const limit = this.limits.get(assetCode);
    if (!limit) return 0;
    this.rollWindow(limit, nowTs());
    return Math.max(0, limit.dailyLimit - limit.dailyUsed);
  }

  /** Reset all mint limits (used in tests / treasury reset). */
  reset(): void {
    this.limits.clear();
  }
}

/**
 * Burn limit engine — enforces per-asset daily + per-tx limits on
 * Twin Token redemption. Identically-shaped to `MintLimitEngine`
 * minus the cooldown (burns have no cooldown).
 */
export class BurnLimitEngine {
  private limits = new Map<string, BurnLimit>();

  /**
   * Configure (or reconfigure) the burn limit for an asset.
   *
   * Backward-compat: accepts either `(assetCode, config)` or a single
   * `({ assetCode, ...config })` object.
   */
  configure(assetCodeOrConfig: string | (BurnLimitConfig & { assetCode: string }), config?: BurnLimitConfig): BurnLimit {
    const assetCode = typeof assetCodeOrConfig === 'string'
      ? assetCodeOrConfig
      : assetCodeOrConfig.assetCode;
    const cfg = typeof assetCodeOrConfig === 'string'
      ? (config ?? { dailyLimit: 0, perTxLimit: 0 })
      : assetCodeOrConfig;
    const existing = this.limits.get(assetCode);
    const limit: BurnLimit = {
      assetCode,
      dailyLimit: cfg.dailyLimit,
      perTxLimit: cfg.perTxLimit,
      dailyUsed: existing?.dailyUsed ?? 0,
      windowStartTs: existing?.windowStartTs ?? nowTs(),
    };
    this.limits.set(assetCode, limit);
    return limit;
  }

  /** Get the current burn limit state for an asset (or undefined). */
  get(assetCode: string): BurnLimit | undefined {
    return this.limits.get(assetCode);
  }

  /** All configured burn limits. */
  all(): BurnLimit[] {
    return [...this.limits.values()];
  }

  private rollWindow(limit: BurnLimit, now: number): void {
    if (now - limit.windowStartTs >= DAY_MS) {
      limit.windowStartTs = now;
      limit.dailyUsed = 0;
    }
  }

  /**
   * Check whether a burn of `amount` would be allowed. Does NOT
   * record the burn — call `recordBurn()` after the burn succeeds.
   */
  checkBurn(assetCode: string, amount: number): LimitCheckResult {
    const limit = this.limits.get(assetCode);
    if (!limit) {
      return { allowed: false, reason: `no_burn_limit_configured:${assetCode}` };
    }
    if (amount <= 0) {
      return { allowed: false, reason: 'non_positive_amount', remainingDaily: Math.max(0, limit.dailyLimit - limit.dailyUsed) };
    }
    const now = nowTs();
    this.rollWindow(limit, now);
    const remainingDaily = Math.max(0, limit.dailyLimit - limit.dailyUsed);

    if (amount > limit.perTxLimit) {
      eventEngine.emit('treasury.burn_blocked', {
        assetCode, amount, reason: 'per_tx_limit_exceeded',
        perTxLimit: limit.perTxLimit,
      });
      return {
        allowed: false,
        reason: `per_tx_limit_exceeded:${amount}>${limit.perTxLimit}`,
        remainingDaily,
      };
    }
    if (amount > remainingDaily) {
      eventEngine.emit('treasury.burn_blocked', {
        assetCode, amount, reason: 'daily_limit_exceeded',
        dailyLimit: limit.dailyLimit, dailyUsed: limit.dailyUsed,
      });
      return {
        allowed: false,
        reason: `daily_limit_exceeded:${amount}>${remainingDaily}`,
        remainingDaily,
      };
    }
    return { allowed: true, remainingDaily: remainingDaily - amount };
  }

  /** Record a successful burn against the limit. */
  recordBurn(assetCode: string, amount: number): BurnLimit {
    const limit = this.limits.get(assetCode);
    if (!limit) {
      throw new Error(`no_burn_limit_configured:${assetCode}`);
    }
    const now = nowTs();
    this.rollWindow(limit, now);
    const check = this.checkBurn(assetCode, amount);
    if (!check.allowed) {
      throw new Error(`burn_blocked:${check.reason}`);
    }
    limit.dailyUsed += amount;
    eventEngine.emit('treasury.burn_recorded', {
      assetCode, amount, dailyUsed: limit.dailyUsed,
      dailyLimit: limit.dailyLimit,
      windowStartTs: limit.windowStartTs,
    });
    return limit;
  }

  /** Remaining daily burn headroom. */
  remainingDaily(assetCode: string): number {
    const limit = this.limits.get(assetCode);
    if (!limit) return 0;
    this.rollWindow(limit, nowTs());
    return Math.max(0, limit.dailyLimit - limit.dailyUsed);
  }

  /** Reset all burn limits. */
  reset(): void {
    this.limits.clear();
  }
}

// ---------------------------------------------------------------------------
// Singletons (with default configs pre-loaded)
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_MINT_LIMIT_ENGINE: MintLimitEngine | undefined;
  var __PAYSWAP_BURN_LIMIT_ENGINE: BurnLimitEngine | undefined;
}

export const mintLimitEngine: MintLimitEngine =
  globalThis.__PAYSWAP_MINT_LIMIT_ENGINE ?? new MintLimitEngine();

if (!globalThis.__PAYSWAP_MINT_LIMIT_ENGINE) {
  globalThis.__PAYSWAP_MINT_LIMIT_ENGINE = mintLimitEngine;
  // Pre-configure defaults.
  for (const [asset, cfg] of Object.entries(DEFAULT_MINT_LIMITS)) {
    mintLimitEngine.configure(asset, cfg);
  }
}

export const burnLimitEngine: BurnLimitEngine =
  globalThis.__PAYSWAP_BURN_LIMIT_ENGINE ?? new BurnLimitEngine();

if (!globalThis.__PAYSWAP_BURN_LIMIT_ENGINE) {
  globalThis.__PAYSWAP_BURN_LIMIT_ENGINE = burnLimitEngine;
  for (const [asset, cfg] of Object.entries(DEFAULT_BURN_LIMITS)) {
    burnLimitEngine.configure(asset, cfg);
  }
}
