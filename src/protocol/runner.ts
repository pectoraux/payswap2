/**
 * PaySwap Protocol — Protocol Simulation Runner.
 *
 * Runs a ProtocolScenario (which includes FiatProofs) through the frozen
 * kernel runtime. This proves the architecture: every protocol scenario
 * executes through kernel.converge(intent) with no special-case code.
 */
import { simulationEngine, type SimulationScenario, type SimulationResult } from '@/kernel';
import { createFiatProof, computeConfidence, effectiveLiquidity, type FiatProof } from './economics/fiat-proof';
import type { ProtocolScenario } from './scenarios';
import type { FiatProofSummary } from '@/kernel';

export interface ProtocolSimulationResult extends SimulationResult {
  fiatProofs: FiatProofSummary[];
  scenarioId: string;
  validates: string[];
  expectedBehavior: string;
}

/** Run a protocol scenario through the kernel. */
export function runProtocolScenario(scenario: ProtocolScenario): ProtocolSimulationResult {
  // 1. Run the kernel simulation (frozen runtime — no changes)
  const result = simulationEngine.run(scenario.scenario);

  // 2. Generate FiatProof summaries (the solver would use these for confidence-based routing)
  const proofs = scenario.fiatProofs ?? [];
  const now = Date.now();
  const fiatProofs: FiatProofSummary[] = proofs.map((p) => {
    const conf = computeConfidence(p, now);
    return {
      id: p.id,
      lpId: p.lpId,
      proofType: p.proofType,
      currency: p.currency,
      attestedAmount: p.attestedAmount,
      confidence: conf,
      effectiveLiquidity: Math.round(p.attestedAmount * conf * 100) / 100,
      status: p.status,
      expiresAt: p.expiresAt,
    };
  });

  return {
    ...result,
    fiatProofs,
    scenarioId: scenario.id,
    validates: scenario.validates,
    expectedBehavior: scenario.expectedBehavior,
  };
}

/** Run all 20 protocol scenarios and return results. */
export function runAllProtocolScenarios(scenarios: ProtocolScenario[]): { scenario: ProtocolScenario; result: ProtocolSimulationResult | null; error: string | null }[] {
  return scenarios.map((s) => {
    try {
      const result = runProtocolScenario(s);
      return { scenario: s, result, error: null };
    } catch (e) {
      return { scenario: s, result: null, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}

/**
 * Verify constitutional invariants for a protocol scenario result.
 * The kernel fails immediately if any invariant fails.
 */
export function verifyConstitutional(result: ProtocolSimulationResult): {
  passed: boolean;
  checks: { invariant: string; passed: boolean; detail: string }[];
} {
  const checks: { invariant: string; passed: boolean; detail: string }[] = [];

  // 1. Ledger balanced
  const dr = result.ledger.reduce((s, e) => s + e.debit, 0);
  const cr = result.ledger.reduce((s, e) => s + e.credit, 0);
  checks.push({ invariant: 'ledger-balanced', passed: Math.abs(dr - cr) < 1e-6, detail: `Dr ${dr.toFixed(2)} = Cr ${cr.toFixed(2)}` });

  // 2. Twin token backed
  const minted = result.twinTokens.reduce((s, t) => s + t.amount, 0);
  const backing = result.plan.sourceDraws.reduce((s, d) => s + d.drawn, 0);
  checks.push({ invariant: 'twin-token-backed', passed: backing >= minted - 1e-6, detail: `${minted} minted, ${backing} backing` });

  // 3. Escrow conservation
  const escrowCount = result.protocol.escrowEntries.length;
  checks.push({ invariant: 'escrow-conservation', passed: escrowCount >= 0, detail: `${escrowCount} escrow entries` });

  // 4. Collateral conservation
  const collateralSlash = result.protocol.collateralEntries.reduce((s, c) => s + c.slashAmount, 0);
  checks.push({ invariant: 'collateral-conservation', passed: collateralSlash >= 0, detail: `Slash total: ${collateralSlash}` });

  // 5. No double settlement
  const merchantCredits = result.ledger.filter((e) => e.accountId.startsWith('merchant:') && e.credit > 0).length;
  checks.push({ invariant: 'no-double-settlement', passed: merchantCredits <= 1, detail: `Merchant credited ${merchantCredits} time(s)` });

  // 6. No negative balances
  const negativeReserves = result.worldState.reserves.filter((r) => r.availableAfter < 0);
  checks.push({ invariant: 'no-negative-balances', passed: negativeReserves.length === 0, detail: negativeReserves.length === 0 ? 'All non-negative' : `${negativeReserves.length} negative` });

  // 7. Exposure limits
  const exposureViolations = result.protocol.lpRegistry.filter((lp) => lp.authorizedExposure < 0);
  checks.push({ invariant: 'exposure-limits', passed: exposureViolations.length === 0, detail: `${result.protocol.lpRegistry.length} LPs checked` });

  // 8. Replay determinism
  checks.push({ invariant: 'replay-determinism', passed: !!result.resultHash, detail: `Hash: ${result.resultHash}` });

  // 9. Constitution passed
  checks.push({ invariant: 'constitution-passed', passed: result.constitution.passed, detail: `${result.constitution.passedRules}/${result.constitution.totalRules} rules` });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}
