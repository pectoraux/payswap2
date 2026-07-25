/**
 * Treasury v2 — Mint / burn limit engines.
 *
 * Two parallel engines: `MintLimitEngine` and `BurnLimitEngine`. Each enforces:
 *   - A daily cap (rolling 24h window): no mint/burn can push dailyUsed above
 *     `dailyLimit`.
 *   - A per-tx cap: no single mint/burn can exceed `perTxLimit`.
 *   - (Mint only) A cooldown: minimum milliseconds between mints to the same
 *     recipient. Set to 0 to disable.
 *
 * Window roll-over: when the time since `windowStartTs` exceeds 24h, the window
 * rolls over — `dailyUsed` resets to 0 and `windowStartTs` advances to now.
 * This is checked lazily on every `checkMint` / `recordMint` / `checkBurn` /
 * `recordBurn` call.
 *
 * Invariants:
 *  - No mint can exceed the daily limit or per-tx limit (checkMint returns
 *    `{ allowed: false, reason }` and the caller MUST honor it).
 *  - `recordMint(assetCode, amount)` does NOT check limits — it assumes the
 *    caller has already called `checkMint` and honored the result. It only
 *    increments `dailyUsed` and updates `lastMintTs`. This separation makes
 *    "check then record" patterns explicit and audit-friendly.
 *  - Burns are bounded because unbounded burns could mask insolvency (burning
 *    destroys the protocol's liability to redeem, so an attacker who could
 *    burn unbounded tokens could hide a shortfall). The same daily + per-tx
 *    caps apply.
 */
import { eventEngine } from '@/kernel/event';
import { round } from '@/kernel/support';
import type {
  BurnLimit,
  BurnLimitConfig,
  LimitCheckResult,
  MintLimit,
  MintLimitConfig,
} from './types';
import {
  DAY_MS,
  DEFAULT_DAILY_BURN_LIMIT,
  DEFAULT_DAILY_MINT_LIMIT,
  DEFAULT_PER_TX_BURN_LIMIT,
  DEFAULT_PER_TX_MINT_LIMIT,
  DEFAULT_MINT_COOLDOWN_MS,
} from './types';

/* ========================================================================== */
/* MintLimitEngine                                                             */
/* ========================================================================== */

export class MintLimitEngine {
  private limits: Map<string, MintLimit> = new Map();

  /**
   * Configure mint limits for an asset. If limits already exist for this
   * assetCode, the dailyUsed / windowStartTs are preserved (so re-configuring
   * mid-window doesn't reset the running tally).
   */
  configure(config: MintLimitConfig): MintLimit {
    const existing = this.limits.get(config.assetCode);
    const limit: MintLimit = {
      assetCode: config.assetCode,
      dailyLimit: config.dailyLimit,
      perTxLimit: config.perTxLimit,
      cooldownMs: config.cooldownMs ?? DEFAULT_MINT_COOLDOWN_MS,
      dailyUsed: existing?.dailyUsed ?? 0,
      windowStartTs: existing?.windowStartTs ?? Date.now(),
      lastMintTs: existing?.lastMintTs ?? 0,
    };
    this.limits.set(config.assetCode, limit);
    return limit;
  }

  /** Get the current mint limit config for an asset. Undefined if not configured. */
  get(assetCode: string): MintLimit | undefined {
    this.resetIfWindowExpired(assetCode);
    return this.limits.get(assetCode);
  }

  /** All configured mint limits. */
  all(): MintLimit[] {
    for (const assetCode of this.limits.keys()) this.resetIfWindowExpired(assetCode);
    return [...this.limits.values()];
  }

  /**
   * Check whether a mint of `amount` units of `assetCode` is allowed.
   *
   * Returns `{ allowed: true, remainingDaily }` if allowed, or
   * `{ allowed: false, reason }` if denied. Reasons:
   *   - `not_configured` : no limit set for this asset (denied by default)
   *   - `per_tx_exceeded`: amount > perTxLimit
   *   - `daily_exceeded` : dailyUsed + amount > dailyLimit
   *   - `cooldown_active`: lastMintTs + cooldownMs > now (recipient must wait)
   *
   * `remainingDaily` is always returned when allowed (and may be 0 if the
   * mint exactly hits the cap).
   */
  checkMint(assetCode: string, amount: number, now: number = Date.now()): LimitCheckResult {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return { allowed: false, reason: 'not_configured' };
    if (amount <= 0) return { allowed: false, reason: 'amount_must_be_positive' };

    if (amount > limit.perTxLimit) {
      return { allowed: false, reason: 'per_tx_exceeded', remainingDaily: this.remainingDaily(assetCode) };
    }

    if (limit.dailyUsed + amount > limit.dailyLimit) {
      return { allowed: false, reason: 'daily_exceeded', remainingDaily: this.remainingDaily(assetCode) };
    }

    if (limit.cooldownMs > 0 && limit.lastMintTs > 0) {
      const elapsed = now - limit.lastMintTs;
      if (elapsed < limit.cooldownMs) {
        return {
          allowed: false,
          reason: 'cooldown_active',
          remainingDaily: this.remainingDaily(assetCode),
        };
      }
    }

    return {
      allowed: true,
      remainingDaily: round(limit.dailyLimit - limit.dailyUsed - amount, 6),
    };
  }

  /**
   * Record a successful mint of `amount` units of `assetCode`. Does NOT check
   * limits — the caller MUST call `checkMint` first and honor the result.
   *
   * Increments `dailyUsed` and updates `lastMintTs`. Rolls over the window if
   * expired. Emits a `treasury.mint_recorded` event.
   */
  recordMint(assetCode: string, amount: number, now: number = Date.now()): MintLimit | undefined {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return undefined;
    limit.dailyUsed = round(limit.dailyUsed + amount, 6);
    limit.lastMintTs = now;
    eventEngine.emit('treasury.mint_recorded', {
      assetCode,
      amount,
      dailyUsed: limit.dailyUsed,
      dailyLimit: limit.dailyLimit,
      remaining: round(limit.dailyLimit - limit.dailyUsed, 6),
    }, 0);
    return limit;
  }

  /** Remaining daily allowance for an asset (after window roll-over). */
  remainingDaily(assetCode: string, now: number = Date.now()): number {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return 0;
    return round(Math.max(0, limit.dailyLimit - limit.dailyUsed), 6);
  }

  /**
   * Roll over the daily window if 24h have elapsed since `windowStartTs`.
   * Resets `dailyUsed` to 0 and advances `windowStartTs` to now.
   */
  resetIfWindowExpired(assetCode: string, now: number = Date.now()): boolean {
    const limit = this.limits.get(assetCode);
    if (!limit) return false;
    if (now - limit.windowStartTs >= DAY_MS) {
      limit.windowStartTs = now;
      limit.dailyUsed = 0;
      eventEngine.emit('treasury.mint_window_rolled', { assetCode, newWindowStart: now }, 0);
      return true;
    }
    return false;
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.limits.clear();
  }
}

/* ========================================================================== */
/* BurnLimitEngine                                                             */
/* ========================================================================== */

export class BurnLimitEngine {
  private limits: Map<string, BurnLimit> = new Map();

  /** Configure burn limits for an asset. Preserves running tallies if re-set. */
  configure(config: BurnLimitConfig): BurnLimit {
    const existing = this.limits.get(config.assetCode);
    const limit: BurnLimit = {
      assetCode: config.assetCode,
      dailyLimit: config.dailyLimit,
      perTxLimit: config.perTxLimit,
      dailyUsed: existing?.dailyUsed ?? 0,
      windowStartTs: existing?.windowStartTs ?? Date.now(),
    };
    this.limits.set(config.assetCode, limit);
    return limit;
  }

  /** Get the current burn limit config for an asset. */
  get(assetCode: string): BurnLimit | undefined {
    this.resetIfWindowExpired(assetCode);
    return this.limits.get(assetCode);
  }

  /** All configured burn limits. */
  all(): BurnLimit[] {
    for (const assetCode of this.limits.keys()) this.resetIfWindowExpired(assetCode);
    return [...this.limits.values()];
  }

  /** Check whether a burn of `amount` units of `assetCode` is allowed. */
  checkBurn(assetCode: string, amount: number, now: number = Date.now()): LimitCheckResult {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return { allowed: false, reason: 'not_configured' };
    if (amount <= 0) return { allowed: false, reason: 'amount_must_be_positive' };

    if (amount > limit.perTxLimit) {
      return { allowed: false, reason: 'per_tx_exceeded', remainingDaily: this.remainingDaily(assetCode) };
    }

    if (limit.dailyUsed + amount > limit.dailyLimit) {
      return { allowed: false, reason: 'daily_exceeded', remainingDaily: this.remainingDaily(assetCode) };
    }

    return {
      allowed: true,
      remainingDaily: round(limit.dailyLimit - limit.dailyUsed - amount, 6),
    };
  }

  /** Record a successful burn of `amount` units of `assetCode`. */
  recordBurn(assetCode: string, amount: number, now: number = Date.now()): BurnLimit | undefined {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return undefined;
    limit.dailyUsed = round(limit.dailyUsed + amount, 6);
    eventEngine.emit('treasury.burn_recorded', {
      assetCode,
      amount,
      dailyUsed: limit.dailyUsed,
      dailyLimit: limit.dailyLimit,
      remaining: round(limit.dailyLimit - limit.dailyUsed, 6),
    }, 0);
    return limit;
  }

  /** Remaining daily burn allowance for an asset. */
  remainingDaily(assetCode: string, now: number = Date.now()): number {
    this.resetIfWindowExpired(assetCode, now);
    const limit = this.limits.get(assetCode);
    if (!limit) return 0;
    return round(Math.max(0, limit.dailyLimit - limit.dailyUsed), 6);
  }

  /** Roll over the daily window if 24h have elapsed. */
  resetIfWindowExpired(assetCode: string, now: number = Date.now()): boolean {
    const limit = this.limits.get(assetCode);
    if (!limit) return false;
    if (now - limit.windowStartTs >= DAY_MS) {
      limit.windowStartTs = now;
      limit.dailyUsed = 0;
      eventEngine.emit('treasury.burn_window_rolled', { assetCode, newWindowStart: now }, 0);
      return true;
    }
    return false;
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.limits.clear();
  }
}

/* ========================================================================== */
/* Singletons                                                                  */
/* ========================================================================== */

/** Singleton mint limit engine. */
export const mintLimitEngine = new MintLimitEngine();

/** Singleton burn limit engine. */
export const burnLimitEngine = new BurnLimitEngine();

/* ========================================================================== */
/* Defaults helper — bootstrap common asset limits in one call                */
/* ========================================================================== */

/**
 * Bootstrap default mint + burn limits for a list of asset codes. Useful at
 * treasury init time so every registered Twin Token has sane limits.
 */
export function bootstrapDefaultLimits(
  assetCodes: string[],
  opts?: {
    dailyMint?: number;
    perTxMint?: number;
    cooldownMs?: number;
    dailyBurn?: number;
    perTxBurn?: number;
  },
): void {
  const dailyMint = opts?.dailyMint ?? DEFAULT_DAILY_MINT_LIMIT;
  const perTxMint = opts?.perTxMint ?? DEFAULT_PER_TX_MINT_LIMIT;
  const cooldownMs = opts?.cooldownMs ?? DEFAULT_MINT_COOLDOWN_MS;
  const dailyBurn = opts?.dailyBurn ?? DEFAULT_DAILY_BURN_LIMIT;
  const perTxBurn = opts?.perTxBurn ?? DEFAULT_PER_TX_BURN_LIMIT;
  for (const code of assetCodes) {
    mintLimitEngine.configure({ assetCode: code, dailyLimit: dailyMint, perTxLimit: perTxMint, cooldownMs });
    burnLimitEngine.configure({ assetCode: code, dailyLimit: dailyBurn, perTxLimit: perTxBurn });
  }
}
