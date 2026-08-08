/**
 * S2: LP Mandate Service — standing authorization for FIAT bandwidth (tier 2).
 *
 * Tier 2 (LP FIAT bandwidth) requires an LP to authorize PaySwap to
 * auto-debit their PSP/bank/rail account. This service manages:
 *   - Mandate registration (LP authorizes auto-debit)
 *   - Per-transaction and daily caps
 *   - Mandate revocation (LP can withdraw authorization)
 *   - Reversal reserve (buffer for failed debits)
 *
 * An LP without an active mandate NEVER appears at tier 2, regardless
 * of their balance. Revoking a mandate removes them without touching
 * in-flight settlements.
 */

export interface LpMandate {
  lpId: string;
  country: string;
  currency: string;
  /** The PSP/bank account reference (e.g. MTN MoMo number, bank account). */
  accountReference: string;
  /** Standing authorization status. */
  status: 'active' | 'revoked' | 'suspended';
  /** Per-transaction cap. */
  perTransactionLimit: number;
  /** Daily cap. */
  dailyLimit: number;
  /** Amount used today (resets daily). */
  dailyUsed: number;
  /** Day window start (for daily reset). */
  dailyWindowStart: number;
  /** Reversal reserve — buffer held for failed debits. */
  reversalReserve: number;
  /** Mandate reference number (from the PSP/bank). */
  mandateReference: string;
  /** When the mandate was granted. */
  grantedAt: number;
  /** When it was revoked (if applicable). */
  revokedAt: number | null;
}

export interface MandateCheckResult {
  allowed: boolean;
  reason?: string;
  availableAmount: number;
}

export class LpMandateService {
  private mandates = new Map<string, LpMandate>(); // key: lpId:country:currency

  /** Register a new mandate (LP authorizes auto-debit). */
  register(params: {
    lpId: string;
    country: string;
    currency: string;
    accountReference: string;
    perTransactionLimit: number;
    dailyLimit: number;
    reversalReserve?: number;
    mandateReference: string;
  }): LpMandate {
    const key = this.key(params.lpId, params.country, params.currency);
    const mandate: LpMandate = {
      lpId: params.lpId,
      country: params.country,
      currency: params.currency,
      accountReference: params.accountReference,
      status: 'active',
      perTransactionLimit: params.perTransactionLimit,
      dailyLimit: params.dailyLimit,
      dailyUsed: 0,
      dailyWindowStart: Date.now(),
      reversalReserve: params.reversalReserve ?? Math.min(params.perTransactionLimit * 0.1, 10_000),
      mandateReference: params.mandateReference,
      grantedAt: Date.now(),
      revokedAt: null,
    };
    this.mandates.set(key, mandate);
    return mandate;
  }

  /**
   * Check if an LP can be debited for a given amount.
   * This is the tier-2 gate — if it returns { allowed: false },
   * the waterfall skips to the next tier.
   */
  check(lpId: string, country: string, currency: string, amount: number): MandateCheckResult {
    const key = this.key(lpId, country, currency);
    const mandate = this.mandates.get(key);

    if (!mandate) {
      return { allowed: false, reason: 'no_mandate', availableAmount: 0 };
    }
    if (mandate.status !== 'active') {
      return { allowed: false, reason: `mandate_${mandate.status}`, availableAmount: 0 };
    }
    if (amount > mandate.perTransactionLimit) {
      return { allowed: false, reason: 'exceeds_per_transaction_limit', availableAmount: mandate.perTransactionLimit };
    }

    // Roll daily window
    this.rollDailyWindow(mandate);

    const dailyRemaining = mandate.dailyLimit - mandate.dailyUsed;
    if (amount > dailyRemaining) {
      return { allowed: false, reason: 'exceeds_daily_limit', availableAmount: dailyRemaining };
    }

    return { allowed: true, availableAmount: Math.min(amount, dailyRemaining) };
  }

  /** Record a successful debit (updates daily usage). */
  recordDebit(lpId: string, country: string, currency: string, amount: number): void {
    const key = this.key(lpId, country, currency);
    const mandate = this.mandates.get(key);
    if (!mandate) return;
    this.rollDailyWindow(mandate);
    mandate.dailyUsed += amount;
  }

  /** Revoke a mandate (LP withdraws authorization). */
  revoke(lpId: string, country: string, currency: string): boolean {
    const key = this.key(lpId, country, currency);
    const mandate = this.mandates.get(key);
    if (!mandate || mandate.status !== 'active') return false;
    mandate.status = 'revoked';
    mandate.revokedAt = Date.now();
    return true;
  }

  /** Suspend a mandate (admin action, e.g. fraud suspicion). */
  suspend(lpId: string, country: string, currency: string): boolean {
    const key = this.key(lpId, country, currency);
    const mandate = this.mandates.get(key);
    if (!mandate || mandate.status !== 'active') return false;
    mandate.status = 'suspended';
    return true;
  }

  /** Reactivate a suspended mandate. */
  reactivate(lpId: string, country: string, currency: string): boolean {
    const key = this.key(lpId, country, currency);
    const mandate = this.mandates.get(key);
    if (!mandate || mandate.status !== 'suspended') return false;
    mandate.status = 'active';
    return true;
  }

  /** List all active mandates for a country (for tier-2 candidate selection). */
  listActiveByCountry(country: string, currency: string): LpMandate[] {
    return Array.from(this.mandates.values()).filter(
      (m) => m.country === country && m.currency === currency && m.status === 'active',
    );
  }

  /** Get total available FIAT bandwidth for a country/currency. */
  getTotalAvailable(country: string, currency: string): number {
    return this.listActiveByCountry(country, currency).reduce((sum, m) => {
      this.rollDailyWindow(m);
      return sum + Math.max(0, m.dailyLimit - m.dailyUsed);
    }, 0);
  }

  private rollDailyWindow(mandate: LpMandate): void {
    const DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - mandate.dailyWindowStart >= DAY) {
      mandate.dailyUsed = 0;
      mandate.dailyWindowStart = Date.now();
    }
  }

  private key(lpId: string, country: string, currency: string): string {
    return `${lpId}:${country}:${currency}`;
  }
}

/** Singleton mandate service. */
export const lpMandateService = new LpMandateService();
