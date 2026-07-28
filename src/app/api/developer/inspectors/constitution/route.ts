/**
 * GET /api/developer/inspectors/constitution
 *
 * Reads from payswapRuntime.invariants (the Invariant Engine) and payswapRuntime.controlPlane
 * (the Economic Constitution).
 *
 * Returns:
 *   - invariants: all registered invariants with their last result + recent violations
 *   - constitution: the constitutional config + a fresh validation result
 *   - stats: total/healthy/unhealthy counts
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InvariantView {
  id: string;
  description: string;
  handles: string[];
  healthy: boolean;
  lastRun: number | null;
  violationCount: number;
  recentViolations: Array<{
    invariantId: string;
    message: string;
    severity: 'error' | 'warning';
    event?: { type: string; streamId: string; globalPosition: number };
    projection?: { name: string; id: string };
    command?: { intentId: string; correlationId: string };
  }>;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const report = payswapRuntime.invariants.report();
    const registry = payswapRuntime.invariants.getRegistry();
    const constitutionConfig = payswapRuntime.controlPlane.getConstitution();

    const invariants: InvariantView[] = report.invariants.map((h) => {
      // Pull the handles from the registered invariant object.
      const invariant = registry.get(h.id);
      const handles = invariant?.handles ?? [];
      return {
        id: h.id,
        description: h.description,
        handles,
        healthy: h.healthy,
        lastRun: h.lastRun,
        violationCount: h.violationCount,
        recentViolations: h.recentViolations.map((v) => ({
          invariantId: v.invariantId,
          message: v.message,
          severity: v.severity,
          event: v.event ? {
            type: v.event.type,
            streamId: v.event.streamId,
            globalPosition: v.event.globalPosition,
          } : undefined,
          projection: v.projection ? { name: v.projection.name, id: v.projection.id } : undefined,
          command: v.command ? { intentId: v.command.intentId, correlationId: v.command.correlationId } : undefined,
        })),
      };
    });

    // All recent violations across all invariants (flattened, most-recent first).
    const allViolations: Array<{
      invariantId: string;
      message: string;
      severity: 'error' | 'warning';
      lastRun: number | null;
    }> = [];
    for (const inv of report.invariants) {
      for (const v of inv.recentViolations) {
        allViolations.push({
          invariantId: v.invariantId,
          message: v.message,
          severity: v.severity,
          lastRun: inv.lastRun,
        });
      }
    }
    allViolations.sort((a, b) => (b.lastRun ?? 0) - (a.lastRun ?? 0));

    // Constitutional rules — derived from the config (10 rules in the engine).
    const constitutionalRules = [
      {
        ruleId: 'twin-backing',
        name: 'Twin Token Backing',
        description: `Twin token backing ratio ≥ ${constitutionConfig.minBackingRatio}`,
        enforced: constitutionConfig.minBackingRatio > 0,
      },
      {
        ruleId: 'reserve-coverage',
        name: 'Reserve Coverage',
        description: `Reserve coverage ≥ ${(constitutionConfig.minReserveCoverage * 100).toFixed(1)}%`,
        enforced: constitutionConfig.minReserveCoverage > 0,
      },
      {
        ruleId: 'lp-exposure',
        name: 'LP Exposure Limit',
        description: `LP exposure ≤ ${constitutionConfig.maxLPExposurePercent}% of total reserves`,
        enforced: constitutionConfig.maxLPExposurePercent > 0,
      },
      {
        ruleId: 'country-concentration',
        name: 'Country Concentration',
        description: `Country exposure ≤ ${constitutionConfig.maxCountryConcentrationPercent}%`,
        enforced: constitutionConfig.maxCountryConcentrationPercent > 0,
      },
      {
        ruleId: 'stablecoin-exposure',
        name: 'Stablecoin Exposure',
        description: `Stablecoin exposure ≤ ${constitutionConfig.maxStablecoinExposurePercent}%`,
        enforced: constitutionConfig.maxStablecoinExposurePercent > 0,
      },
      {
        ruleId: 'escrow-before-release',
        name: 'Escrow Before Release',
        description: 'Escrow must be locked before settlement release',
        enforced: constitutionConfig.requireEscrowBeforeRelease,
      },
      {
        ruleId: 'recipient-confirmation',
        name: 'Recipient Confirmation',
        description: 'Recipient must confirm before settlement release',
        enforced: constitutionConfig.requireRecipientConfirmation,
      },
      {
        ruleId: 'supported-rail',
        name: 'Supported Settlement Rail',
        description: 'Settlement must use a supported rail',
        enforced: constitutionConfig.requireSupportedRail,
      },
      {
        ruleId: 'transaction-coordinator',
        name: 'Transaction Coordinator',
        description: 'All mutations must go through the Transaction Coordinator',
        enforced: constitutionConfig.requireTransactionCoordinator,
      },
      {
        ruleId: 'settlement-contract',
        name: 'Settlement Contract',
        description: 'Settlement must use a Settlement Contract',
        enforced: constitutionConfig.requireSettlementContract,
      },
    ];

    return NextResponse.json({
      ok: true,
      invariants,
      constitutionalRules,
      violations: allViolations,
      stats: {
        total: report.total,
        healthy: report.healthy,
        unhealthy: report.unhealthy,
        rulesEnforced: constitutionalRules.filter((r) => r.enforced).length,
        rulesTotal: constitutionalRules.length,
        violationsTotal: allViolations.length,
        errorViolations: allViolations.filter((v) => v.severity === 'error').length,
        warningViolations: allViolations.filter((v) => v.severity === 'warning').length,
      },
    });
  } catch (err) {
    console.error('[api/developer/inspectors/constitution] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
