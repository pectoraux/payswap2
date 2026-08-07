/**
 * MON-6: Property tests for the money invariants.
 *
 * These tests run over random transaction sequences and assert:
 *   1. Debits == credits exactly (the double-entry invariant)
 *   2. Fee + netAmount == grossAmount exactly (the split invariant)
 *   3. No sequence produces a fractional minor unit (the integer invariant)
 *   4. allocate() sums exactly to the total (the split-rounding invariant)
 *
 * These run in CI on every commit. If any of them fail, the money math is
 * broken — a one-cent leak would fail the exact equality check.
 *
 * Run: `bun test tests/money.property.test.ts`
 */

import { describe, it, expect } from 'bun:test';
import { Money, money } from '../src/money';

// Deterministic PRNG for reproducible test runs.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);
function randomAmount(max: number = 1_000_000): number {
  return Math.floor(rng() * max * 100) / 100; // 2 decimal places
}
function randomBps(max: number = 200): number {
  return Math.floor(rng() * max);
}

describe('MON-6: Money property tests', () => {
  describe('MON-4: exact balance check', () => {
    it('fee + netAmount == grossAmount for 10,000 random amounts', () => {
      let failures = 0;
      for (let i = 0; i < 10_000; i++) {
        const gross = money.ghs(randomAmount(1_000_000));
        const feeBps = randomBps(200); // 0-200 bps = 0-2%
        const fee = gross.mulBps(feeBps);
        const net = gross.subtract(fee);

        // Exact equality: fee + net == gross
        if (!fee.add(net).equals(gross)) {
          failures++;
          if (failures <= 3) {
            console.error(`  FAIL: gross=${gross.toMajorString()} bps=${feeBps} fee=${fee.toMajorString()} net=${net.toMajorString()} fee+net=${fee.add(net).toMajorString()}`);
          }
        }
      }
      expect(failures).toBe(0);
    });

    it('debits == credits exactly for 1,000 random journal entries', () => {
      let failures = 0;
      for (let i = 0; i < 1_000; i++) {
        const amount = money.usd(randomAmount(100_000));
        const feeBps = randomBps(150);
        const fee = amount.mulBps(feeBps);
        const net = amount.subtract(fee);

        // Double-entry: debit amount, credit net + fee
        const debit = amount;
        const credit = net.add(fee);

        if (!debit.equals(credit)) {
          failures++;
          if (failures <= 3) {
            console.error(`  FAIL: debit=${debit.toMajorString()} credit=${credit.toMajorString()} diff=${debit.subtract(credit).toMajorString()}`);
          }
        }
      }
      expect(failures).toBe(0);
    });
  });

  describe('MON-1: integer minor units (no fractional minor units)', () => {
    it('mulBps always produces an integer minor unit', () => {
      for (let i = 0; i < 10_000; i++) {
        const amount = money.ngn(randomAmount(1_000_000));
        const fee = amount.mulBps(randomBps(300));
        // minorUnits must be an integer (BigInt is always integer, but check)
        expect(typeof fee.minorUnits).toBe('bigint');
      }
    });

    it('add/subtract preserve integer minor units', () => {
      for (let i = 0; i < 1_000; i++) {
        const a = money.ghs(randomAmount(50_000));
        const b = money.ghs(randomAmount(50_000));
        const sum = a.add(b);
        const diff = a.subtract(b);
        expect(typeof sum.minorUnits).toBe('bigint');
        expect(typeof diff.minorUnits).toBe('bigint');
        // sum must equal a + b exactly
        expect(sum.minorUnits).toBe(a.minorUnits + b.minorUnits);
      }
    });
  });

  describe('MON-5: allocate() sums exactly to total', () => {
    it('allocate(2-way) parts sum to total for 1,000 random splits', () => {
      for (let i = 0; i < 1_000; i++) {
        const total = money.usd(randomAmount(100_000));
        const ratio1 = rng();
        const ratio2 = rng();
        const [part1, part2] = total.allocate([ratio1, ratio2]);

        // Parts must sum EXACTLY to total — no rounding gap.
        const sum = part1.add(part2);
        if (!sum.equals(total)) {
          console.error(`  FAIL: total=${total.toMajorString()} part1=${part1.toMajorString()} part2=${part2.toMajorString()} sum=${sum.toMajorString()}`);
        }
        expect(sum.equals(total)).toBe(true);
      }
    });

    it('allocate(3-way) parts sum to total for 1,000 random splits', () => {
      for (let i = 0; i < 1_000; i++) {
        const total = money.ghs(randomAmount(50_000));
        const [p1, p2, p3] = total.allocate([rng(), rng(), rng()]);
        const sum = p1.add(p2).add(p3);
        expect(sum.equals(total)).toBe(true);
      }
    });

    it('allocate(5-way) parts sum to total for 1,000 random splits', () => {
      for (let i = 0; i < 1_000; i++) {
        const total = money.ngn(randomAmount(500_000));
        const parts = total.allocate([rng(), rng(), rng(), rng(), rng()]);
        const sum = Money.sum(parts);
        expect(sum.equals(total)).toBe(true);
      }
    });
  });

  describe('MON-1: currency mismatch is a compile-time + runtime error', () => {
    it('add() throws on currency mismatch', () => {
      const ghs = money.ghs(100);
      const usd = money.usd(100);
      expect(() => ghs.add(usd)).toThrow(/currency mismatch/);
    });

    it('subtract() throws on currency mismatch', () => {
      const ghs = money.ghs(100);
      const usd = money.usd(100);
      expect(() => ghs.subtract(usd)).toThrow(/currency mismatch/);
    });

    it('equals() returns false for different currencies', () => {
      const ghs = money.ghs(100);
      const usd = money.usd(100);
      expect(ghs.equals(usd)).toBe(false);
    });
  });

  describe('MON-2: JSON serialization round-trips exactly', () => {
    it('toJSON → fromJSON preserves the exact minor units', () => {
      for (let i = 0; i < 1_000; i++) {
        const original = money.usdc(randomAmount(10_000));
        const json = original.toJSON();
        const restored = Money.fromJSON({ minorUnits: json.minorUnits, currency: json.currency });
        expect(restored.equals(original)).toBe(true);
      }
    });
  });
});
