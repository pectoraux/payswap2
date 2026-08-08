/**
 * PaySwap CROWN-JEWEL — Single-Rule Invariant Test.
 *
 * Task ID: RESTORE-CROWN-JEWELS.
 *
 * PROVES: there is ONE settlement-tier-selection rule in the codebase, not
 * parallel implementations. Before this invariant was added, commits
 * 54cf685/dce745b hand-routed payments in `handlers.ts` (bypassing the
 * policy engine entirely) — a silent routing change that no test caught.
 * This test is the gate: it FAILS the moment any module outside
 * `settlement-waterfall.ts` reintroduces a hand-written tier-selection
 * matrix.
 *
 * The three assertions:
 *   1. `settlement-waterfall.ts` is the ONLY module that implements tier
 *      selection — no other source file matches the hand-coded
 *      `if (...hasFiatReserve...) return 'LOCAL_RAIL'` pattern.
 *   2. `policy-engine.ts::selectStrategy()` delegates to `resolvePayment`
 *      from `settlement-waterfall` (not a hand-written matrix).
 *   3. `handlers.ts` imports `resolvePayment` from `settlement-waterfall`
 *      (does not re-implement tier selection locally).
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PROJECT_ROOT = join(import.meta.dir, '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');
const WATERFALL_PATH = 'src/runtime/liquidity/settlement-waterfall.ts';
const POLICY_ENGINE_PATH = 'src/runtime/liquidity/policy-engine.ts';
const HANDLERS_PATH = 'src/runtime/dispatcher/handlers.ts';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Recursively walk a directory, yielding file paths (relative to PROJECT_ROOT). */
function* walk(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const abs = join(dir, entry);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      // Skip node_modules, .next, dist, build artifacts.
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry === '.git') continue;
      yield* walk(abs);
    } else if (st.isFile() && (abs.endsWith('.ts') || abs.endsWith('.tsx'))) {
      yield relative(PROJECT_ROOT, abs);
    }
  }
}

/** Read a project file's contents as a string. */
function read(rel: string): string {
  return readFileSync(join(PROJECT_ROOT, rel), 'utf8');
}

// ─── The 3 assertions ──────────────────────────────────────────────────

describe('single-rule-invariant — there is ONE tier-selection rule', () => {
  /**
   * Pattern: a function body that returns a settlement-strategy literal
   * based on a reserve-availability check. The pattern that was reverted
   * by 54cf685/dce745b looked like:
   *
   *   if (input.fromCountry === input.toCountry) return 'LOCAL_RAIL';
   *   if (input.senderReserve.hasFiatReserve && input.receiverReserve.hasFiatReserve) return 'RESERVE_TO_RESERVE';
   *
   * The settlement-waterfall legitimately uses `return { strategy: 'LOCAL_RAIL', ... }`
   * inside `resolvePayment`. We exclude it from the forbidden-pattern
   * scan because it IS the single rule.
   */
  const HAND_CODED_MATRIX_PATTERNS: RegExp[] = [
    /return\s+'LOCAL_RAIL'\s*;/,
    /return\s+'RESERVE_TO_RESERVE'\s*;/,
    /return\s+'RESERVE_TO_MARKET'\s*;/,
    /return\s+'MARKET_TO_RESERVE'\s*;/,
    /return\s+'MARKET_TO_MARKET'\s*;/,
  ];

  it('settlement-waterfall.ts is the ONLY module that implements tier selection', () => {
    const offenders: string[] = [];
    for (const rel of walk(SRC_ROOT)) {
      // The waterfall is the canonical implementation — skip it.
      if (rel === WATERFALL_PATH) continue;
      // policy-engine.ts is allowed to call resolvePayment + map tier-5 to
      // MARKET_TO_MARKET (the legacy enum has no MANUAL_SETTLEMENT slot).
      // It is asserted separately in the next test.
      if (rel === POLICY_ENGINE_PATH) continue;
      // Skip test fixtures + showcases that reference strategy literals
      // by name (they're not tier-SELECTION, just labels).
      if (rel.startsWith('src/app/api/showcase')) continue;
      if (rel.includes('/__fixtures__/')) continue;

      let src: string;
      try { src = read(rel); } catch { continue; }
      for (const pat of HAND_CODED_MATRIX_PATTERNS) {
        if (pat.test(src)) {
          offenders.push(`${rel} (matched ${pat})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('policy-engine.ts selectStrategy() delegates to resolvePayment', () => {
    const src = read(POLICY_ENGINE_PATH);
    // 1. Imports resolvePayment from ./settlement-waterfall.
    expect(src).toMatch(/import\s+\{[^}]*resolvePayment[^}]*\}\s+from\s+['"]\.\/settlement-waterfall['"]/);
    // 2. selectStrategy body calls resolvePayment(input).
    expect(src).toMatch(/selectStrategy\s*\([^)]*\)\s*:\s*SettlementStrategy\s*\{[^}]*resolvePayment\s*\(/);
    // 3. Does NOT have a hand-coded tier-selection matrix (no
    //    `if (...hasFiatReserve...) return 'LOCAL_RAIL'` style).
    expect(src).not.toMatch(/if\s*\(\s*input\.fromCountry\s*===\s*input\.toCountry\s*\)\s*\{\s*return\s+'LOCAL_RAIL'/);
    expect(src).not.toMatch(/return\s+'LOCAL_RAIL'\s*;\s*\n/);
    expect(src).not.toMatch(/return\s+'RESERVE_TO_RESERVE'\s*;\s*\n/);
    expect(src).not.toMatch(/return\s+'RESERVE_TO_MARKET'\s*;\s*\n/);
    expect(src).not.toMatch(/return\s+'MARKET_TO_RESERVE'\s*;\s*\n/);
    // Allow the single `if (result.tier === 5) return 'MARKET_TO_MARKET';`
    // — that's the tier-5 → enum fallback, NOT a hand-coded matrix.
    // The forbidden pattern is a multi-line sequence, so a single
    // `return 'MARKET_TO_MARKET';` line on its own is acceptable.
  });

  it('handlers.ts imports resolvePayment from settlement-waterfall', () => {
    const src = read(HANDLERS_PATH);
    // Imports resolvePayment from ../liquidity/settlement-waterfall
    // (handlers.ts is in runtime/dispatcher/, so the relative path is ../liquidity/).
    expect(src).toMatch(/import\s+\{[^}]*resolvePayment[^}]*\}\s+from\s+['"]\.\.\/liquidity\/settlement-waterfall['"]/);
    // Calls resolvePayment somewhere in the payment handler body.
    expect(src).toMatch(/resolvePayment\s*\(/);
    // Does NOT have a hand-coded tier-selection matrix.
    expect(src).not.toMatch(/if\s*\(\s*input\.fromCountry\s*===\s*input\.toCountry\s*\)\s*\{\s*return\s+'LOCAL_RAIL'/);
  });
});
