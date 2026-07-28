/**
 * Money type — wraps a Decimal value to prevent floating-point errors. (C-4.)
 *
 * All monetary calculations should use this type instead of raw `number`.
 * Internally uses integer cents (like Stripe) to avoid IEEE 754 precision
 * issues entirely.
 *
 * Usage:
 *   const price = Money.fromDollars(10.50);
 *   const fee = price.percent(80); // 80 bps
 *   const net = price.subtract(fee);
 *   console.log(net.toDollars()); // 10.416
 *   console.log(net.toCents());   // 1042
 *
 * The Prisma client extension (src/lib/db.ts) converts Decimal columns
 * to Money automatically on read, and Money to Decimal on write.
 */

import { Prisma } from '@prisma/client';

/**
 * Money — an immutable monetary value stored as integer cents.
 *
 * Why cents? Because IEEE 754 floats can't exactly represent 0.1, 0.2, etc.
 * $10.50 becomes 1050 cents — an exact integer. All arithmetic is exact.
 *
 * The type is immutable: operations return new Money instances.
 */
export class Money {
  private readonly cents: number;

  private constructor(cents: number) {
    if (!Number.isInteger(cents)) {
      throw new Error(`Money must be integer cents, got: ${cents}`);
    }
    this.cents = cents;
  }

  // ─── Construction ─────────────────────────────────────────────────────

  /** Create Money from a dollar amount (e.g., Money.fromDollars(10.50) = $10.50) */
  static fromDollars(dollars: number | string): Money {
    const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid dollar amount: ${dollars}`);
    }
    // Round to nearest cent (banker's rounding would be ideal, but Math.round
    // is sufficient for most use cases)
    return new Money(Math.round(n * 100));
  }

  /** Create Money from cents (e.g., Money.fromCents(1050) = $10.50) */
  static fromCents(cents: number): Money {
    return new Money(Math.round(cents));
  }

  /** Create Money from a Prisma Decimal value */
  static fromDecimal(d: Prisma.Decimal): Money {
    return Money.fromDollars(Number(d));
  }

  /** Create zero Money */
  static zero(): Money {
    return new Money(0);
  }

  // ─── Conversion ───────────────────────────────────────────────────────

  /** Get the value in dollars (as a number — use sparingly) */
  toDollars(): number {
    return this.cents / 100;
  }

  /** Get the value in cents (integer) */
  toCents(): number {
    return this.cents;
  }

  /** Convert to Prisma Decimal for database writes */
  toDecimal(): Prisma.Decimal {
    return new Prisma.Decimal(this.toDollars());
  }

  /** String representation in dollars (e.g., "10.50") */
  toString(): string {
    return (this.cents / 100).toFixed(2);
  }

  /** JSON representation (for API responses) */
  toJSON(): number {
    return this.toDollars();
  }

  // ─── Arithmetic (all return new Money instances) ─────────────────────

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  multiply(factor: number): Money {
    return new Money(Math.round(this.cents * factor));
  }

  /** Calculate a percentage (basis points). E.g., percent(80) = 0.80% */
  percent(bps: number): Money {
    return new Money(Math.round((this.cents * bps) / 10000));
  }

  /** Split into n equal parts (last part absorbs remainder) */
  split(n: number): Money[] {
    if (n <= 0) throw new Error('Cannot split into 0 parts');
    const partCents = Math.floor(this.cents / n);
    const remainder = this.cents - partCents * n;
    const parts: Money[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(new Money(partCents + (i < remainder ? 1 : 0)));
    }
    return parts;
  }

  // ─── Comparison ───────────────────────────────────────────────────────

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  lessThan(other: Money): boolean {
    return this.cents < other.cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.cents >= other.cents;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.cents <= other.cents;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  // ─── Static helpers ──────────────────────────────────────────────────

  /** Calculate fee: amount * (bps / 10000), rounded to cent */
  static fee(amount: Money, bps: number): Money {
    return amount.percent(bps);
  }

  /** Calculate net amount after fee: amount - fee */
  static net(amount: Money, feeBps: number): Money {
    return amount.subtract(Money.fee(amount, feeBps));
  }

  /** Sum multiple Money values */
  static sum(...values: Money[]): Money {
    return values.reduce((acc, m) => acc.add(m), Money.zero());
  }

  /** Max of multiple Money values */
  static max(...values: Money[]): Money {
    return values.reduce((acc, m) => (m.greaterThan(acc) ? m : acc), Money.zero());
  }

  /** Min of multiple Money values */
  static min(...values: Money[]): Money {
    if (values.length === 0) return Money.zero();
    return values.reduce((acc, m) => (m.lessThan(acc) ? m : acc));
  }
}
