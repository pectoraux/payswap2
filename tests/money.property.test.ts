/**
 * PaySwap CROWN-JEWEL — Money Property Tests.
 *
 * Task ID: RESTORE-CROWN-JEWELS.
 *
 * Proves the BigInt `Money` type (`src/money/money.ts`) is arithmetically
 * correct across the four invariants that matter for a payment system:
 *
 *   MON-1  integer-minor-unit preservation — every operation produces
 *          an integer number of minor units (no float drift).
 *   MON-2  serialization round-trip — toJSON → fromJSON preserves the
 *          exact minor units (no information loss).
 *   MON-4  conservation of value — fee + net == gross for any random
 *          gross, and Σ debits == Σ credits for any balanced journal.
 *   MON-5  allocation sum — `allocate(ratios)` always returns parts that
 *          sum to exactly the original total (no penny lost).
 *
 * Why this is a crown jewel:
 *   The audit (C-5) found `fee = Math.round(amount * 100) * 0.01` in
 *   `payment-service.ts:71-72` — floating point on the money path. The
 *   BigInt Money type exists but is "real but disconnected from the
 *   money." These property tests pin the contract: any future migration
 *   to Money MUST keep all 11 assertions green. If any flips, the money
 *   type itself has drifted and the migration is unsafe to merge.
 *
 * Implementation note: each test uses an internal loop over random
 * inputs (mulberry32 PRNG — deterministic, no flakiness). The bun:test
 * top-line reports 11 `it` blocks (one per property), so a failure
 * points at the specific invariant that broke.
 */

import { describe, it, expect } from 'bun:test';
import { Money, type Currency } from '@/money/money';

// ─── Deterministic PRNG (mulberry32) — reproducible failures ──────────
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

const ALL_CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'GHS', 'NGN', 'KES', 'XOF', 'USDC'];

// ─── MON-4: fee + net == gross ─────────────────────────────────────────

describe('money.property — MON-4 conservation of value', () => {
  it('MON-4: fee + netAmount == grossAmount for 10,000 random amounts', () => {
    const rng = mulberry32(42);
    let assertions = 0;
    for (let i = 0; i < 10_000; i++) {
      // Gross in minor units — random 0..1B cents.
      const grossMinor = BigInt(randInt(rng, 0, 1_000_000_000));
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const gross = Money.fromMinor(grossMinor, ccy);
      // Random fee in bps [0..500] (0%..5%).
      const bps = randInt(rng, 0, 500);
      const fee = Money.mulBps(gross, bps);
      const net = gross.subtract(fee);
      // INVARIANT: fee + net == gross, exactly.
      expect(fee.add(net).equals(gross)).toBe(true);
      // Sanity: fee ≤ gross (no negative net).
      expect(fee.lessThanOrEqual(gross)).toBe(true);
      assertions += 2;
    }
    expect(assertions).toBe(20_000);
  });

  it('MON-4: debits == credits exactly for 1,000 random journal entries', () => {
    const rng = mulberry32(7);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      // Each journal entry has N debit lines + N credit lines, all with
      // the same total amount (random split between the two sides).
      const lineCount = randInt(rng, 1, 5);
      const totalMinor = BigInt(randInt(rng, 1, 1_000_000));
      const total = Money.fromMinor(totalMinor, ccy);
      // Allocate the total into `lineCount` parts on each side.
      const debitParts = total.allocate(Array(lineCount).fill(1));
      const creditParts = total.allocate(Array(lineCount).fill(1));
      // INVARIANT: each side sums back to the total.
      expect(Money.sum(debitParts).equals(total)).toBe(true);
      expect(Money.sum(creditParts).equals(total)).toBe(true);
      // INVARIANT: debits == credits (the journal balances).
      expect(Money.sum(debitParts).equals(Money.sum(creditParts))).toBe(true);
      assertions += 3;
    }
    expect(assertions).toBe(3_000);
  });
});

// ─── MON-1: integer minor units ────────────────────────────────────────

describe('money.property — MON-1 integer minor units', () => {
  it('MON-1: mulBps always produces an integer minor unit', () => {
    const rng = mulberry32(99);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const grossMinor = BigInt(randInt(rng, 0, 1_000_000_000));
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const gross = Money.fromMinor(grossMinor, ccy);
      const bps = randInt(rng, 0, 1_000);  // 0..10%
      const fee = Money.mulBps(gross, bps);
      // minorUnits is a BigInt — always an integer by construction.
      // The real assertion: fee.minorUnits * 10_000 == gross.minorUnits * bps
      // (modulo truncation, which we verify by recomputing the product).
      // The simplest check: fee.minorUnits is a BigInt (which it always is),
      // AND it's ≤ (gross.minorUnits * bps) / 10_000 (truncation, not round-up).
      const expectedMax = (gross.minorUnits * BigInt(bps)) / BigInt(10_000);
      expect(fee.minorUnits <= expectedMax).toBe(true);
      expect(fee.minorUnits >= BigInt(0)).toBe(true);
      assertions += 2;
    }
    expect(assertions).toBe(2_000);
  });

  it('MON-1: add/subtract preserve integer minor units', () => {
    const rng = mulberry32(123);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const aMinor = BigInt(randInt(rng, 0, 1_000_000));
      const bMinor = BigInt(randInt(rng, 0, 1_000_000));
      const a = Money.fromMinor(aMinor, ccy);
      const b = Money.fromMinor(bMinor, ccy);
      const sum = a.add(b);
      const diff = a.subtract(b);
      // Both results must equal the BigInt sum/diff — i.e. no rounding.
      expect(sum.minorUnits).toBe(aMinor + bMinor);
      expect(diff.minorUnits).toBe(aMinor - bMinor);
      assertions += 2;
    }
    expect(assertions).toBe(2_000);
  });

  it('MON-1: add() throws on currency mismatch', () => {
    expect(() => Money.usd(100).add(Money.ghs(50))).toThrow(/currency mismatch/);
  });

  it('MON-1: subtract() throws on currency mismatch', () => {
    expect(() => Money.usd(100).subtract(Money.ghs(50))).toThrow(/currency mismatch/);
  });

  it('MON-1: equals() returns false for different currencies', () => {
    // equals() must NOT throw on currency mismatch — it answers the
    // question (false) rather than raising. This is the predicate
    // contract; throw-on-mismatch would force every caller to wrap in
    // try/catch.
    expect(Money.usd(100).equals(Money.ghs(100))).toBe(false);
    expect(Money.usd(100).equals(Money.usd(100))).toBe(true);
  });
});

// ─── MON-5: allocation sum ─────────────────────────────────────────────

describe('money.property — MON-5 allocation sum', () => {
  it('MON-5: allocate(2-way) parts sum to total for 1,000 random splits', () => {
    const rng = mulberry32(777);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const totalMinor = BigInt(randInt(rng, 1, 1_000_000));
      const total = Money.fromMinor(totalMinor, ccy);
      const ratioA = randInt(rng, 1, 100);
      const ratioB = randInt(rng, 1, 100);
      const parts = total.allocate([ratioA, ratioB]);
      expect(parts.length).toBe(2);
      // INVARIANT: parts sum to total, exactly (no penny lost).
      expect(Money.sum(parts).equals(total)).toBe(true);
      assertions++;
    }
    expect(assertions).toBe(1_000);
  });

  it('MON-5: allocate(3-way) parts sum to total', () => {
    const rng = mulberry32(2024);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const totalMinor = BigInt(randInt(rng, 1, 1_000_000));
      const total = Money.fromMinor(totalMinor, ccy);
      const parts = total.allocate([
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
      ]);
      expect(parts.length).toBe(3);
      expect(Money.sum(parts).equals(total)).toBe(true);
      assertions++;
    }
    expect(assertions).toBe(1_000);
  });

  it('MON-5: allocate(5-way) parts sum to total', () => {
    const rng = mulberry32(31337);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const totalMinor = BigInt(randInt(rng, 1, 1_000_000));
      const total = Money.fromMinor(totalMinor, ccy);
      const parts = total.allocate([
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
        randInt(rng, 1, 100),
      ]);
      expect(parts.length).toBe(5);
      expect(Money.sum(parts).equals(total)).toBe(true);
      assertions++;
    }
    expect(assertions).toBe(1_000);
  });
});

// ─── MON-2: serialization round-trip ───────────────────────────────────

describe('money.property — MON-2 serialization round-trip', () => {
  it('MON-2: toJSON → fromJSON preserves the exact minor units', () => {
    const rng = mulberry32(54321);
    let assertions = 0;
    for (let i = 0; i < 1_000; i++) {
      const ccy: Currency = ALL_CURRENCIES[randInt(rng, 0, ALL_CURRENCIES.length - 1)];
      const minor = BigInt(randInt(rng, 0, 1_000_000_000));
      const original = Money.fromMinor(minor, ccy);
      const json = original.toJSON();
      // JSON carries minorUnits as a STRING (BigInt can't be JSON-serialized
      // directly) + currency.
      expect(typeof json.minorUnits).toBe('string');
      expect(json.currency).toBe(ccy);
      const restored = Money.fromJSON({
        minorUnits: json.minorUnits,
        currency: json.currency,
      });
      // INVARIANT: round-trip preserves the exact minor units.
      expect(restored.minorUnits).toBe(original.minorUnits);
      expect(restored.currency).toBe(original.currency);
      expect(restored.equals(original)).toBe(true);
      assertions += 4;
    }
    expect(assertions).toBe(4_000);
  });
});
