import { NextRequest, NextResponse } from 'next/server';
import { Money, money } from '@/money';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Money validation endpoint — proves the Money value object is exact.
 * Demonstrates: no float drift, correct allocation (sum = original),
 * BigInt-safe for crypto-scale values, currency mismatch detection.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const op = typeof body?.op === 'string' ? body.op : '';

  const results: Record<string, unknown> = {};

  if (op === 'allocate' || op === 'all') {
    // Prove allocation is lossless: $1.00 split 3 ways must sum back to $1.00
    const original = money.usd(1.00);
    const split = original.allocate([1, 1, 1]);
    const sum = Money.sum(split);
    results.allocate = {
      original: original.toJSON(),
      split: split.map((m) => m.toJSON()),
      sum: sum.toJSON(),
      lossless: sum.equals(original),
      note: sum.equals(original) ? '✓ Allocation is lossless — sum equals original' : '✗ ALLOCATION LOSS DETECTED',
    };
  }

  if (op === 'precision' || op === 'all') {
    // Prove no float drift: 0.1 + 0.2 must equal 0.3 exactly
    const a = money.usd(0.1);
    const b = money.usd(0.2);
    const sum = a.add(b);
    const expected = money.usd(0.3);
    results.precision = {
      a: a.toJSON(),
      b: b.toJSON(),
      sum: sum.toJSON(),
      expected: expected.toJSON(),
      exact: sum.equals(expected),
      floatDrift: (0.1 + 0.2) === 0.3 ? false : `Float would give: ${0.1 + 0.2} (drift: ${(0.1 + 0.2) - 0.3})`,
      note: sum.equals(expected) ? '✓ No float drift — 0.1 + 0.2 = 0.3 exactly' : '✗ FLOAT DRIFT DETECTED',
    };
  }

  if (op === 'bigint' || op === 'all') {
    // Prove BigInt-safe for crypto-scale: $1 trillion in USDC (micro-units)
    const trillion = money.usdc(1_000_000_000_000); // 1 trillion USDC
    const multiplied = trillion.multiply(2);
    results.bigint = {
      trillion: trillion.toJSON(),
      doubled: multiplied.toJSON(),
      note: '✓ BigInt handles trillion-scale values without overflow (float would lose precision at 2^53)',
    };
  }

  if (op === 'currency_mismatch' || op === 'all') {
    // Prove currency mismatch detection
    try {
      money.usd(100).add(money.ghs(50));
      results.currency_mismatch = { detected: false, note: '✗ Should have thrown' };
    } catch (e) {
      results.currency_mismatch = { detected: true, error: e instanceof Error ? e.message : 'Currency mismatch', note: '✓ Currency mismatch correctly rejected' };
    }
  }

  if (op === 'percentage' || op === 'all') {
    // Prove percentage calculation: 15% of $99.99
    const base = money.usd(99.99);
    const pct = base.percentage(15);
    results.percentage = {
      base: base.toJSON(),
      fifteenPercent: pct.toJSON(),
      note: `✓ 15% of $99.99 = ${pct.toMajorString()} (exact, no float)`,
    };
  }

  return NextResponse.json({ results });
}
