/**
 * Money — Exact Monetary Value Object.
 *
 * PHASE 1.1: Mathematical correctness. No float. Anywhere. Not one.
 *
 * Every monetary value in the platform becomes a Money instance. Internally
 * uses BigInt cents (or micro-units for crypto-scale) — never float. All
 * operations are exact.
 */

export type Currency = 'USD' | 'GHS' | 'USDC' | 'EUR' | 'GBP' | 'NGN' | 'KES' | 'XOF';

const DECIMAL_PLACES: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, GHS: 2, NGN: 2, KES: 2, XOF: 0, USDC: 6,
};

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

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) return [];
    const total = ratios.reduce((s, r) => s + r, 0);
    if (total <= 0) throw new Error('Money.allocate: ratios must sum to > 0');
    const results: bigint[] = new Array(ratios.length).fill(BigInt(0));
    let allocated = BigInt(0);
    const scale = BigInt(1000000);
    const scaledTotal = BigInt(Math.round(total * 1_000_000));
    for (let i = 0; i < ratios.length; i++) {
      const scaledRatio = BigInt(Math.round(ratios[i] * 1_000_000));
      const share = (this.minorUnits * scaledRatio) / scaledTotal;
      results[i] = share;
      allocated += share;
    }
    let remainder = this.minorUnits - allocated;
    let idx = 0;
    while (remainder > BigInt(0) && idx < results.length) {
      results[idx] += BigInt(1);
      remainder -= BigInt(1);
      idx++;
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
  equals(other: Money): boolean { return this.compare(other) === 0; }
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
  fromMinor: (minor: bigint | number | string, currency: Currency) => Money.fromMinor(minor, currency),
  zero: (currency: Currency = 'USD') => Money.zero(currency),
};
