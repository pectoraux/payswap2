/**
 * MON-2: Money codecs at every boundary.
 *
 * The boundary between Prisma's `Decimal` type, JSON serialization, and
 * the internal `Money` type. This module is the SINGLE place where Money
 * is constructed from external sources (DB, API request bodies, event
 * payloads). Every other module should use `Money` directly.
 *
 * Rules:
 *  - Prisma `Decimal` → `Money.fromMinor(decimal * 10^exponent, currency)`
 *  - API JSON request → `MoneyCodec.fromRequestBody(value, currency)`
 *  - API JSON response → `MoneyCodec.toResponseBody(money)` → `{ amount: "1234", currency: "GHS", exponent: 2 }`
 *  - Event payload → `MoneyCodec.fromEventPayload(payload, field, currency)`
 *
 * The `amount` field in JSON is ALWAYS a string (never a number) so no JS
 * client can silently truncate it to a float.
 */

import { Money, type Currency } from './money';
import { Prisma } from '@prisma/client';

// ── Currency exponent table ──────────────────────────────────────────────

const DECIMAL_PLACES: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, GHS: 2, NGN: 2, KES: 2, XOF: 0, USDC: 6,
  ZAR: 2, UGX: 0, RWF: 0, TZS: 0,
};

export function exponentFor(currency: string): number {
  return DECIMAL_PLACES[currency] ?? 2;
}

// ── Prisma Decimal ↔ Money ───────────────────────────────────────────────

/**
 * Convert a Prisma `Decimal` (or a number/string that Prisma might return)
 * to a `Money` instance. The Decimal is in MAJOR units (e.g. 12.34 GHS).
 */
export function decimalToMoney(value: Prisma.Decimal | number | string | null | undefined, currency: Currency): Money {
  if (value === null || value === undefined) return Money.zero(currency);
  const str = typeof value === 'string' ? value : value.toString();
  return Money.fromMajor(str, currency);
}

/**
 * Convert a `Money` instance to a Prisma-compatible Decimal string (major units).
 * Use this when writing to Prisma columns that are `Decimal` type.
 */
export function moneyToDecimalString(money: Money): string {
  return money.toMajorString();
}

// ── API JSON request body ↔ Money ────────────────────────────────────────

/**
 * Parse a value from an API request body into a `Money` instance.
 *
 * Accepts:
 *  - string: "12.34" (preferred — no float truncation)
 *  - number: 12.34 (accepted but discouraged — converted via toFixed)
 *  - object: { amount: "1234", currency: "GHS" } (the canonical JSON shape)
 *
 * Throws if the value is invalid. Never returns null — the caller should
 * catch and return 400.
 */
export function fromRequestBody(value: unknown, currency: Currency): Money {
  if (value === null || value === undefined) {
    throw new Error(`Money.fromRequestBody: value is ${value}`);
  }
  if (typeof value === 'string') {
    return Money.fromMajor(value, currency);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Money.fromRequestBody: number is not finite: ${value}`);
    }
    return Money.fromMajor(value, currency);
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as { amount?: unknown; currency?: unknown };
    if (obj.amount !== undefined && obj.currency !== undefined) {
      const objCurrency = obj.currency as Currency;
      if (objCurrency !== currency) {
        throw new Error(`Money.fromRequestBody: currency mismatch — expected ${currency}, got ${objCurrency}`);
      }
      return fromRequestBody(obj.amount, currency);
    }
  }
  throw new Error(`Money.fromRequestBody: invalid value type: ${typeof value}`);
}

/**
 * Convert a `Money` instance to the canonical JSON response body shape.
 * The `amount` field is ALWAYS a string (minor units) so no JS client
 * can silently truncate it to a float.
 */
export function toResponseBody(money: Money): {
  amount: string;
  currency: Currency;
  exponent: number;
  major: string;
} {
  return {
    amount: money.minorUnits.toString(),
    currency: money.currency,
    exponent: exponentFor(money.currency),
    major: money.toMajorString(),
  };
}

// ── Event payload ↔ Money ────────────────────────────────────────────────

/**
 * Extract a Money value from an event payload field.
 * Event payloads store money as numbers (for backwards compatibility with
 * existing events). This helper converts safely.
 */
export function fromEventPayload(payload: Record<string, unknown>, field: string, currency: Currency): Money | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  try {
    return fromRequestBody(value, currency);
  } catch {
    return null;
  }
}

// ── Lint helper: detect bare number money ────────────────────────────────

/**
 * MON-2 lint rule (documentation — the actual rule would be a custom ESLint
 * rule, but this documents the pattern):
 *
 * BAD:  `const fee = Math.round(amount * 0.008 * 100) / 100;`
 * GOOD: `const fee = grossMoney.mulBps(80);`
 *
 * BAD:  `payload.amount = 1500;`
 * GOOD: `payload.amount = moneyToResponseBody(Money.fromMajor(1500, 'GHS'));`
 *
 * The grep for `amount: number` in the codebase should eventually return
 * zero results outside of type definitions and legacy Prisma models.
 */

export const MoneyCodec = {
  fromPrisma: decimalToMoney,
  toPrisma: moneyToDecimalString,
  fromRequest: fromRequestBody,
  toResponse: toResponseBody,
  fromEvent: fromEventPayload,
  exponentFor,
};
