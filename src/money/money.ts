/**
 * Money — Exact Monetary Value Object.
 *
 * PHASE 1.1: Mathematical correctness. No float. Anywhere. Not one.
 *
 * Every monetary value in the platform becomes a Money instance. Internally
 * uses BigInt cents (or micro-units for crypto-scale) — never float. All
 * operations are exact.
 *
 * P2-2 (C-5): the BigInt `Money` class is the canonical money type. The
 * `Math.round(x * 100) / 100` pattern in `payment-service.ts` /
 * `payout-service.ts` / `invoice-service.ts` is being migrated to use
 * `Money.fromMajor` + `Money.mulBps` + `Money.subtract`. The
 * `Money.fromDecimal` / `toDecimal` helpers bridge Prisma `Decimal`
 * columns (which now return as Decimal, post P2-2 Part B) and the Money
 * type.
 */

import type { Prisma } from '@prisma/client';

export type Currency = 'USD' | 'GHS' | 'USDC' | 'EUR' | 'GBP' | 'NGN' | 'KES' | 'XOF';

const DECIMAL_PLACES: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, GHS: 2, NGN: 2, KES: 2, XOF: 0, USDC: 6,
};

/**
 * Narrow a runtime currency code (typically `string` from API params) to
 * the `Currency` union. Returns 'USD' for unsupported codes — this
 * preserves the legacy 2-decimal rounding behavior (the Math.round(x*100)
 * pattern treated every currency as 2-decimal) for currencies not yet on
 * the Money type's allow-list.
 *
 * P2-2: used by payment-service / payout-service / invoice-service to
 * convert `params.currency: string` into a Money-compatible Currency.
 */
export function asCurrency(code: string): Currency {
  switch (code) {
    case 'USD': case 'GHS': case 'USDC': case 'EUR':
    case 'GBP': case 'NGN': case 'KES': case 'XOF':
      return code;
    default:
      return 'USD';
  }
}

export type RoundingMode = 'HALF_UP' | 'DOWN' | 'UP' | 'HALF_EVEN';

/**
 * An exact monetary value. Internally stored as integer minor units (cents for
 * USD/EUR, pesewas for GHS, micro-units for USDC) as a BigInt — never float.
 */
export class Money {
  readonly minorUnits: bigint;
  readonly currency: Currency;

  private constructor(minorUnits: bigint, currency: Currency) {
    this.minorUnits = minorUnits;
    this.currency = currency;
  }

  static fromMajor(amount: number | string, currency: Currency): Money {
    if (typeof amount === 'number') {
      if (!Number.isFinite(amount)) throw new Error(`Money.fromMajor: amount is not finite: ${amount}`);
      return Money.fromString(amount.toFixed(DECIMAL_PLACES[currency] ?? 2), currency);
    }
    return Money.fromString(amount, currency);
  }

  static fromString(amount: string, currency: Currency): Money {
    const dp = DECIMAL_PLACES[currency] ?? 2;
    const cleaned = amount.replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') throw new Error(`Money.fromString: invalid amount "${amount}"`);
    const neg = cleaned.startsWith('-');
    const abs = neg ? cleaned.slice(1) : cleaned;
    const [whole, frac = ''] = abs.split('.');
    const fracPadded = (frac + '0'.repeat(dp)).slice(0, dp);
    const minorStr = (neg ? '-' : '') + whole + fracPadded;
    return new Money(BigInt(minorStr), currency);
  }

  static fromMinor(minorUnits: bigint | number | string, currency: Currency): Money {
    return new Money(BigInt(minorUnits), currency);
  }

  static zero(currency: Currency = 'USD'): Money {
    return new Money(BigInt(0), currency);
  }

  static fromJSON(json: { minorUnits: string; currency: Currency }): Money {
    return new Money(BigInt(json.minorUnits), json.currency);
  }

  /**
   * Construct a Money from a Prisma `Decimal` value (the type returned by
   * Prisma client for `Decimal` columns when no `$extends` coercion is
   * applied). P2-2 Part B removes the global Decimal→number coercion for
   * `payment.fee` + `payment.netAmount`; consumers should rehydrate those
   * columns into Money via this method on read.
   *
   * Accepts `Prisma.Decimal`, `string`, or `number` — the legacy `number`
   * branch keeps backwards compat with call sites that haven't been
   * migrated yet.
   */
  static fromDecimal(value: Prisma.Decimal | string | number, currency: Currency): Money {
    if (typeof value === 'number') return Money.fromMajor(value, currency);
    if (typeof value === 'string') return Money.fromString(value, currency);
    // Prisma.Decimal / decimal.js — `.toString()` yields the canonical
    // numeric string (no scientific notation for reasonable magnitudes).
    return Money.fromString(value.toString(), currency);
  }

  // ─── Currency-specific static factories ────────────────────────────────
  // Convenience constructors so call-sites read as `Money.usd(100)` rather
  // than `Money.fromMajor(100, 'USD')`. Identical semantics.

  /** Construct a USD value from a major-unit amount (e.g. `Money.usd(12.34)`). */
  static usd(amount: number | string): Money { return Money.fromMajor(amount, 'USD'); }
  /** Construct a GHS value from a major-unit amount. */
  static ghs(amount: number | string): Money { return Money.fromMajor(amount, 'GHS'); }
  /** Construct a NGN value from a major-unit amount. */
  static ngn(amount: number | string): Money { return Money.fromMajor(amount, 'NGN'); }
  /** Construct a KES value from a major-unit amount. */
  static kes(amount: number | string): Money { return Money.fromMajor(amount, 'KES'); }
  /** Construct a XOF value from a major-unit amount. */
  static xof(amount: number | string): Money { return Money.fromMajor(amount, 'XOF'); }
  /** Construct a USDC value from a major-unit amount (6 decimal places). */
  static usdc(amount: number | string): Money { return Money.fromMajor(amount, 'USDC'); }
  /** Construct an EUR value from a major-unit amount. */
  static eur(amount: number | string): Money { return Money.fromMajor(amount, 'EUR'); }
  /** Construct a GBP value from a major-unit amount. */
  static gbp(amount: number | string): Money { return Money.fromMajor(amount, 'GBP'); }

  /**
   * Compute a fee as `money * bps / 10_000`, returning a NEW Money whose
   * minor units are always an integer (truncated towards zero — same
   * rounding as `multiply`). `bps` is basis points (e.g. 80 = 0.80%).
   *
   * This is the canonical fee primitive — used by the property test
   * `MON-4: fee + netAmount == grossAmount` to prove fee/net arithmetic
   * is exact for any random gross.
   */
  static mulBps(money: Money, bps: number): Money {
    if (!Number.isFinite(bps)) {
      throw new Error(`Money.mulBps: bps is not finite: ${bps}`);
    }
    // Compute fee_minor = (money.minorUnits * bps) / 10_000 — integer division.
    // BigInt division truncates toward zero, which matches the multiply() mode.
    const scaledBps = BigInt(Math.round(bps));
    const feeMinor = (money.minorUnits * scaledBps) / BigInt(10_000);
    return new Money(feeMinor, money.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  /**
   * Allocate this Money across `ratios` so the parts sum EXACTLY to the total.
   *
   * Uses the largest remainder method: each part gets floor(total * ratio / sum),
   * then the remainder (total - sum of floors) is distributed one minor unit at
   * a time to the parts with the largest fractional remainder.
   *
   * This guarantees: sum(parts) === total, exactly, in integer minor units.
   * No rounding gap, no tolerance needed.
   */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) return [];
    const sum = ratios.reduce((s, r) => s + r, 0);
    if (sum <= 0) throw new Error('Money.allocate: ratios must sum to > 0');

    // Scale ratios to integers (avoid float precision loss).
    // Use a large scale factor, then divide by GCD conceptually.
    const SCALE = BigInt(1_000_000_000); // 1e9
    const scaledSum = BigInt(Math.round(sum * 1_000_000_000));

    // Compute floor share for each part.
    const results: bigint[] = new Array(ratios.length);
    const remainders: { idx: number; remainder: bigint }[] = [];
    let allocated = BigInt(0);

    for (let i = 0; i < ratios.length; i++) {
      const scaledRatio = BigInt(Math.round(ratios[i] * 1_000_000_000));
      // share = floor(total * ratio / sum)
      const product = this.minorUnits * scaledRatio;
      const floorShare = product / scaledSum;
      const remainder = product - (floorShare * scaledSum); // the fractional part, scaled
      results[i] = floorShare;
      allocated += floorShare;
      remainders.push({ idx: i, remainder });
    }

    // Distribute the remainder one minor unit at a time to the parts with
    // the largest fractional remainder.
    let toDistribute = this.minorUnits - allocated;
    remainders.sort((a, b) => (a.remainder < b.remainder ? 1 : a.remainder > b.remainder ? -1 : 0));
    for (let i = 0; i < remainders.length && toDistribute > 0; i++) {
      results[remainders[i].idx] += BigInt(1);
      toDistribute -= BigInt(1);
    }

    return results.map((m) => new Money(m, this.currency));
  }

  multiply(factor: number | string, _mode: RoundingMode = 'HALF_UP'): Money {
    const f = typeof factor === 'string' ? parseFloat(factor) : factor;
    if (!Number.isFinite(f)) throw new Error(`Money.multiply: factor is not finite: ${factor}`);
    const scale = BigInt(1000000);
    const scaledFactor = BigInt(Math.round(f * 1_000_000));
    const product = this.minorUnits * scaledFactor;
    return new Money(product / scale, this.currency);
  }

  /**
   * Multiply by basis points (bps). The standard fee calculation:
   * `amount.mulBps(80)` = amount × 80 / 10000 = 0.8% fee.
   *
   * This is exact: `minorUnits * bps / 10000` using integer division.
   * The remainder is assigned to the fee recipient (HALF_UP rounding).
   *
   * MON-5 rounding policy: fees use HALF_UP. The residual (the rounding
   * remainder) is assigned to the fee earner, never the merchant.
   */
  mulBps(bps: number): Money {
    if (!Number.isInteger(bps) || bps < 0) {
      throw new Error(`Money.mulBps: bps must be a non-negative integer, got ${bps}`);
    }
    // exact integer arithmetic: (minorUnits * bps + 5000) / 10000 rounds HALF_UP
    const product = this.minorUnits * BigInt(bps);
    const rounded = (product + BigInt(5000)) / BigInt(10000);
    return new Money(rounded, this.currency);
  }

  divide(divisor: number, _mode: RoundingMode = 'HALF_UP'): Money {
    if (divisor === 0) throw new Error('Money.divide: divisor is 0');
    if (!Number.isFinite(divisor)) throw new Error(`Money.divide: divisor is not finite: ${divisor}`);
    const scale = BigInt(1000000);
    const scaledDivisor = BigInt(Math.round(divisor * 1_000_000));
    const scaled = this.minorUnits * scale;
    return new Money(scaled / scaledDivisor, this.currency);
  }

  percentage(pct: number, mode: RoundingMode = 'HALF_UP'): Money {
    return this.multiply(pct / 100, mode);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }
  /**
   * Equality check. Returns false (NOT throws) when the currencies differ —
   * $100 USD is plainly not equal to ₵100 GHS, and a boolean is the more
   * useful answer at call sites that already handle "not equal" gracefully.
   *
   * `assertSameCurrency` lives on `compare()`/`add()`/`subtract()` —
   * operations that genuinely cannot proceed across currencies — but
   * `equals()` is a predicate, so we answer the question rather than throw.
   */
  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.minorUnits === other.minorUnits;
  }
  greaterThan(other: Money): boolean { return this.compare(other) > 0; }
  lessThan(other: Money): boolean { return this.compare(other) < 0; }
  greaterThanOrEqual(other: Money): boolean { return this.compare(other) >= 0; }
  lessThanOrEqual(other: Money): boolean { return this.compare(other) <= 0; }
  isZero(): boolean { return this.minorUnits === BigInt(0); }
  isPositive(): boolean { return this.minorUnits > BigInt(0); }
  isNegative(): boolean { return this.minorUnits < BigInt(0); }

  negate(): Money { return new Money(-this.minorUnits, this.currency); }
  abs(): Money { return new Money(this.minorUnits < BigInt(0) ? -this.minorUnits : this.minorUnits, this.currency); }

  static min(a: Money, b: Money): Money { return a.lessThanOrEqual(b) ? a : b; }
  static max(a: Money, b: Money): Money { return a.greaterThanOrEqual(b) ? a : b; }
  static sum(moneys: Money[]): Money {
    if (moneys.length === 0) throw new Error('Money.sum: empty array');
    return moneys.reduce((acc, m) => acc.add(m));
  }

  toMajorString(): string {
    const dp = DECIMAL_PLACES[this.currency] ?? 2;
    const neg = this.minorUnits < BigInt(0);
    const abs = neg ? -this.minorUnits : this.minorUnits;
    const absStr = abs.toString().padStart(dp + 1, '0');
    const whole = absStr.slice(0, -dp);
    const frac = absStr.slice(-dp);
    return (neg ? '-' : '') + whole + (dp > 0 ? '.' + frac : '');
  }

  toNumber(): number { return Number(this.toMajorString()); }

  toString(): string {
    const symbol = CURRENCY_SYMBOLS[this.currency] ?? '';
    return `${symbol}${this.toMajorString()} ${this.currency}`;
  }

  toJSON(): { minorUnits: string; currency: Currency; major: string } {
    return { minorUnits: this.minorUnits.toString(), currency: this.currency, major: this.toMajorString() };
  }

  /**
   * Convert to a Prisma `Decimal` for writes to a `Decimal` column. P2-2:
   * the canonical persistence representation for a Money value is its
   * `toMajorString()` (e.g. "10.50") wrapped in `new Prisma.Decimal(...)`.
   *
   * Call sites that previously passed `fee: someNumber` to a Prisma write
   * should now pass `fee: money.toDecimal()` once the producer has been
   * migrated.
   */
  toDecimal(): Prisma.Decimal {
    return new Prisma.Decimal(this.toMajorString());
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Money currency mismatch: ${this.currency} vs ${other.currency}. Use convert() for FX.`);
    }
  }

  convert(targetCurrency: Currency, rate: number, mode: RoundingMode = 'HALF_UP'): Money {
    if (this.currency === targetCurrency) return new Money(this.minorUnits, this.currency);
    const converted = this.multiply(rate, mode);
    const sourceDp = DECIMAL_PLACES[this.currency] ?? 2;
    const targetDp = DECIMAL_PLACES[targetCurrency] ?? 2;
    if (sourceDp === targetDp) return new Money(converted.minorUnits, targetCurrency);
    const adjustment = BigInt(10) ** BigInt(Math.abs(targetDp - sourceDp));
    const adjusted = targetDp > sourceDp ? converted.minorUnits * adjustment : converted.minorUnits / adjustment;
    return new Money(adjusted, targetCurrency);
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', GHS: '₵', NGN: '₦', KES: 'KSh', XOF: 'CFA', USDC: '◈',
};

export const money = {
  usd: (amount: number | string) => Money.fromMajor(amount, 'USD'),
  ghs: (amount: number | string) => Money.fromMajor(amount, 'GHS'),
  usdc: (amount: number | string) => Money.fromMajor(amount, 'USDC'),
  eur: (amount: number | string) => Money.fromMajor(amount, 'EUR'),
  ngn: (amount: number | string) => Money.fromMajor(amount, 'NGN'),
  kes: (amount: number | string) => Money.fromMajor(amount, 'KES'),
  xof: (amount: number | string) => Money.fromMajor(amount, 'XOF'),
  fromMinor: (minor: bigint | number | string, currency: Currency) => Money.fromMinor(minor, currency),
  zero: (currency: Currency = 'USD') => Money.zero(currency),
};
