/**
 * CI-4: Single-rule invariant test.
 *
 * Asserts that `settlement-waterfall.ts` is the ONLY module that implements
 * tier selection. If any other file reintroduces a parallel routing rule
 * (the S3 regression that was caught and fixed), this test fails CI.
 *
 * The test greps for the telltale pattern: a hand-written boolean matrix
 * on `hasFiatReserve` that returns one of the 5 strategy names. That pattern
 * was the S3 bug — `selectStrategy()` in `policy-engine.ts` had it. Now that
 * `selectStrategy()` delegates to `resolvePayment()`, the pattern should
 * not exist anywhere except `settlement-waterfall.ts`.
 *
 * Run: `bun test tests/single-rule-invariant.test.ts`
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const SRC_DIR = join(import.meta.dir, '..', 'src');

// Recursively collect all .ts/.tsx files under src/.
function collectTsFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      // Skip node_modules, .next, etc.
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      collectTsFiles(fullPath, files);
    } else if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
      files.push(fullPath);
    }
  }
  return files;
}

// The canonical routing module — this IS allowed to implement tier selection.
const CANONICAL_ROUTING_FILE = 'src/runtime/liquidity/settlement-waterfall.ts';

// Patterns that indicate a parallel routing rule (the S3 regression).
// Each pattern matches a hand-written strategy-selection branch.
const FORBIDDEN_PATTERNS: { pattern: string; description: string }[] = [
  {
    // The S3 bug: `if (senderReserve.hasFiatReserve && receiverReserve.hasFiatReserve) return 'RESERVE_TO_RESERVE'`
    pattern: /hasFiatReserve\s*&&\s*.*hasFiatReserve.*(?:RESERVE_TO_RESERVE|MARKET_TO_MARKET)/,
    description: 'Hand-written boolean matrix on hasFiatReserve returning a strategy name',
  },
  {
    // `if (senderHasReserve && !receiverHasReserve) return 'RESERVE_TO_MARKET'`
    pattern: /senderHasReserve\s*&&\s*!.*receiver.*RESERVE_TO_MARKET/,
    description: 'Hand-written RESERVE_TO_MARKET selection',
  },
  {
    // `if (!senderHasReserve && receiverHasReserve) return 'MARKET_TO_RESERVE'`
    pattern: /!senderHasReserve\s*&&\s*.*receiver.*MARKET_TO_RESERVE/,
    description: 'Hand-written MARKET_TO_RESERVE selection',
  },
];

describe('CI-4: Single-rule invariant (no parallel routing)', () => {
  it('settlement-waterfall.ts is the ONLY module that implements tier selection', () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: { file: string; description: string; pattern: string }[] = [];

    for (const file of files) {
      const relativePath = file.replace(join(import.meta.dir, '..') + '/', '');

      // The canonical routing file IS allowed to have these patterns.
      if (relativePath === CANONICAL_ROUTING_FILE) continue;

      // Test files are allowed to reference the patterns (in test names, etc.)
      if (relativePath.includes('.test.') || relativePath.includes('tests/')) continue;

      const content = readFileSync(file, 'utf-8');

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({ file: relativePath, description, pattern: pattern.source });
        }
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v => `  ${v.file}: ${v.description} (pattern: ${v.pattern})`).join('\n');
      expect.fail(
        `Found ${violations.length} parallel routing rule(s):\n${details}\n\n` +
        `Only ${CANONICAL_ROUTING_FILE} may implement tier selection. ` +
        `Use resolvePayment() from settlement-waterfall.ts instead.`
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('policy-engine.ts selectStrategy() delegates to resolvePayment (not a hand-written matrix)', () => {
    const policyEnginePath = join(SRC_DIR, 'runtime/liquidity/policy-engine.ts');
    if (!existsSync(policyEnginePath)) {
      expect.fail('policy-engine.ts not found');
    }
    const content = readFileSync(policyEnginePath, 'utf-8');

    // Must import resolvePayment from the waterfall.
    expect(content).toContain("from './settlement-waterfall'");
    expect(content).toContain('resolvePayment');

    // Must NOT contain the old hand-written matrix pattern.
    const oldMatrixPattern = /if\s*\(input\.fromCountry\s*===\s*input\.toCountry\)\s*return\s*'LOCAL_RAIL'/;
    expect(oldMatrixPattern.test(content)).toBe(false);
  });

  it('handlers.ts imports resolvePayment from settlement-waterfall (not a parallel rule)', () => {
    const handlersPath = join(SRC_DIR, 'runtime/dispatcher/handlers.ts');
    if (!existsSync(handlersPath)) {
      expect.fail('handlers.ts not found');
    }
    const content = readFileSync(handlersPath, 'utf-8');

    // Must import from the waterfall, not implement its own routing.
    expect(content).toContain("from '../liquidity/settlement-waterfall'");
    expect(content).toContain('selectSettlementSource');
  });
});
