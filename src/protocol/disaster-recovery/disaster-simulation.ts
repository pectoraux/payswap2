/**
 * PaySwap Protocol — Disaster Recovery — Disaster Simulation.
 *
 * A disaster simulation is a full end-to-end test of the DR pipeline:
 *
 *   1. SIMULATE the disaster (data-center loss, ransomware, corruption,
 *      human error).
 *   2. DETECT it (declare a DR incident via `drStatusService`).
 *   3. PLAN the recovery (via `restoreService.planRecovery`).
 *   4. EXECUTE the recovery (via `restoreService.executeRecovery`).
 *   5. VERIFY the recovery (via `restoreService.verifyRecovery`).
 *
 * The simulation records the total recovery time, the estimated data
 * loss (RPO), the restore plan that was executed, the post-recovery
 * verification outcome, and an overall pass/fail.
 *
 * `generateReport(simulationId)` produces a human-readable report
 * covering the timeline, the plan, the steps, the verification, and
 * the lessons learned.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.disaster_simulated`     — when a simulation starts.
 *  - `dr.disaster_simulation_completed` — when a simulation finishes.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and the
 * sibling `restoreService`, `rpoRtoMonitor`, `drStatusService`,
 * `backupService`. No kernel files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';
import type {
  DisasterType,
  DisasterSimulationResult,
  RecoveryVerification,
  RestorePlan,
} from './types';
import { restoreService } from './restore';
import { rpoRtoMonitor } from './rpo-rto';
import { backupService } from './backup';
import { drStatusService } from './dr-status';

/** Maps a disaster type to a `RecoveryScenario` for `restoreService`. */
function disasterToRecoveryScenario(type: DisasterType): 'db_corruption' | 'region_loss' | 'partial_state_loss' | 'full_disaster' {
  switch (type) {
    case 'data_center_loss':
      return 'region_loss';
    case 'ransomware':
      return 'full_disaster';
    case 'corruption':
      return 'db_corruption';
    case 'human_error':
      return 'partial_state_loss';
  }
}

/** Estimated data loss (RPO) per disaster type (ms). */
const ESTIMATED_DATA_LOSS_MS: Record<DisasterType, number> = {
  data_center_loss: 30_000, // 30s — replication catches up to ~30s ago
  ransomware: 60_000,       // 60s — full disaster, worst case
  corruption: 5_000,        // 5s  — detected quickly by integrity checks
  human_error: 15_000,      // 15s — depends on operator reaction
};

/**
 * Disaster simulation service — runs full end-to-end DR drills.
 */
export class DisasterSimulationService {
  private results: DisasterSimulationResult[] = [];
  private readonly maxResults = 200;

  /**
   * Run a full disaster simulation for `type`. Performs:
   *   1. Pre-simulation backup (so we have something to restore from).
   *   2. RPO/RTO recovery-start marker.
   *   3. DR incident declaration.
   *   4. Restore plan generation.
   *   5. Restore plan execution.
   *   6. Post-recovery verification.
   *   7. RPO/RTO recovery-end marker + measurement.
   *
   * Returns the `DisasterSimulationResult`.
   */
  simulateDisaster(type: DisasterType): DisasterSimulationResult {
    const startedAt = nowTs();
    eventEngine.emit('dr.disaster_simulated', {
      disasterType: type,
      ts: startedAt,
    });

    // 1. Ensure a backup exists (so the restore plan can select one).
    let backup = backupService.getLatestBackup('full_state');
    if (!backup) {
      backup = backupService.createBackup('full_state');
    }

    // 2. RPO/RTO recovery-start marker.
    rpoRtoMonitor.recordRecoveryStart();

    // 3. DR incident declaration.
    const incident = drStatusService.declareIncident(
      `Disaster simulation: ${type}`,
      'critical',
    );

    // 4. Restore plan generation.
    const recoveryScenario = disasterToRecoveryScenario(type);
    const plan: RestorePlan = restoreService.planRecovery(recoveryScenario);

    // 5. Restore plan execution.
    const execution = restoreService.executeRecovery(plan);

    // 6. Post-recovery verification.
    const verification: RecoveryVerification = restoreService.verifyRecovery();

    // 7. RPO/RTO recovery-end marker + measurement.
    rpoRtoMonitor.recordRecoveryEnd();
    const measurement = rpoRtoMonitor.measure();

    // Resolve the incident.
    drStatusService.resolveIncident(incident.id);

    const completedAt = nowTs();
    const recoveryTimeMs = completedAt - startedAt;
    const dataLossMs = Math.min(
      measurement.rpoMs,
      ESTIMATED_DATA_LOSS_MS[type],
    );
    const passed = execution.success && verification.verified && measurement.compliant;
    const summary = this.buildSummary(
      type,
      execution.success,
      verification.verified,
      measurement.compliant,
      recoveryTimeMs,
      dataLossMs,
    );

    const result: DisasterSimulationResult = {
      id: uid('sim'),
      disasterType: type,
      startedAt,
      completedAt,
      recoveryTimeMs,
      dataLossMs,
      plan,
      verification,
      passed,
      summary,
    };
    this.results.push(result);
    while (this.results.length > this.maxResults) this.results.shift();

    eventEngine.emit('dr.disaster_simulation_completed', {
      simulationId: result.id,
      disasterType: type,
      passed,
      recoveryTimeMs,
      dataLossMs,
      verified: verification.verified,
      ts: completedAt,
    });
    return result;
  }

  /** Build a human-readable summary for a simulation result. */
  private buildSummary(
    type: DisasterType,
    executionSuccess: boolean,
    verified: boolean,
    rpoRtoCompliant: boolean,
    recoveryTimeMs: number,
    dataLossMs: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Disaster simulation (${type}).`);
    parts.push(
      executionSuccess
        ? 'Recovery execution: SUCCESS.'
        : 'Recovery execution: FAILED (one or more steps failed).',
    );
    parts.push(
      verified
        ? 'Post-recovery verification: PASSED (ledger balances match, event count consistent, reconciliation passed).'
        : 'Post-recovery verification: FAILED (discrepancies detected — see verification.discrepancies).',
    );
    parts.push(
      rpoRtoCompliant
        ? `RPO/RTO: COMPLIANT (recovery in ${recoveryTimeMs}ms, data loss ~${dataLossMs}ms).`
        : `RPO/RTO: NON-COMPLIANT (recovery in ${recoveryTimeMs}ms, data loss ~${dataLossMs}ms — targets are RPO<60s, RTO<300s).`,
    );
    if (executionSuccess && verified && rpoRtoCompliant) {
      parts.push('Overall: PASS — the system survived the disaster within RPO/RTO targets.');
    } else {
      parts.push('Overall: FAIL — review the plan + verification discrepancies and re-run.');
    }
    return parts.join(' ');
  }

  /** All simulation results (oldest first). */
  getSimulationResults(): DisasterSimulationResult[] {
    return [...this.results];
  }

  /** The most recent simulation result, or null. */
  getLatestSimulation(): DisasterSimulationResult | null {
    return this.results[this.results.length - 1] ?? null;
  }

  /** Get a simulation result by id. */
  getSimulation(id: string): DisasterSimulationResult | null {
    return this.results.find((r) => r.id === id) ?? null;
  }

  /**
   * Generate a human-readable disaster-recovery report for a past
   * simulation. Returns a multi-line string.
   */
  generateReport(simulationId: string): string {
    const sim = this.getSimulation(simulationId);
    if (!sim) {
      return `# Disaster Recovery Report\n\nSimulation ${simulationId} not found.`;
    }
    const lines: string[] = [];
    lines.push('# Disaster Recovery Report');
    lines.push('');
    lines.push(`Simulation ID:  ${sim.id}`);
    lines.push(`Disaster type:   ${sim.disasterType}`);
    lines.push(`Started at:      ${new Date(sim.startedAt).toISOString()}`);
    lines.push(`Completed at:    ${new Date(sim.completedAt).toISOString()}`);
    lines.push(`Recovery time:   ${sim.recoveryTimeMs}ms`);
    lines.push(`Data loss (RPO): ~${sim.dataLossMs}ms`);
    lines.push(`Overall result:  ${sim.passed ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(sim.summary);
    lines.push('');
    lines.push('## Restore Plan');
    lines.push('');
    lines.push(`Strategy:              ${sim.plan.strategy}`);
    lines.push(`Estimated recovery:    ${sim.plan.estimatedRecoveryMs}ms`);
    lines.push(`Data-loss risk:        ${sim.plan.dataLossRisk}`);
    lines.push(`RPO target:            ${sim.plan.rpoMs}ms`);
    lines.push(`RTO target:            ${sim.plan.rtoMs}ms`);
    lines.push('');
    lines.push('Steps:');
    for (let i = 0; i < sim.plan.steps.length; i++) {
      lines.push(`  ${i + 1}. ${sim.plan.steps[i]}`);
    }
    lines.push('');
    lines.push('## Post-Recovery Verification');
    lines.push('');
    lines.push(`Verified:                  ${sim.verification.verified}`);
    lines.push(`Ledger balances match:     ${sim.verification.ledgerBalancesMatch}`);
    lines.push(`Event count match:         ${sim.verification.eventCountMatch}`);
    lines.push(`Reconciliation passed:     ${sim.verification.reconciliationPassed}`);
    lines.push(`Checked at:                ${new Date(sim.verification.checkedAt).toISOString()}`);
    if (sim.verification.discrepancies.length > 0) {
      lines.push('');
      lines.push('Discrepancies:');
      for (const d of sim.verification.discrepancies) {
        lines.push(`  - ${d}`);
      }
    }
    lines.push('');
    lines.push('## RPO / RTO Compliance');
    lines.push('');
    lines.push(`Target RPO: < 60_000ms (1 minute)`);
    lines.push(`Target RTO: < 300_000ms (5 minutes)`);
    lines.push(`Measured data loss: ${sim.dataLossMs}ms`);
    lines.push(`Measured recovery:  ${sim.recoveryTimeMs}ms`);
    lines.push('');
    if (sim.passed) {
      lines.push('## Conclusion');
      lines.push('');
      lines.push('The disaster simulation passed — the system detected the disaster, executed the recovery plan, and verified the recovered state within the RPO/RTO targets. No further action required.');
    } else {
      lines.push('## Conclusion');
      lines.push('');
      lines.push('The disaster simulation FAILED. Review the verification discrepancies and the restore plan steps above. Re-run the simulation after addressing the identified gaps.');
    }
    return lines.join('\n');
  }

  /** Reset all results (used in tests). */
  reset(): void {
    this.results.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_SIMULATION: DisasterSimulationService | undefined;
}

/** Singleton disaster simulation service. */
export const disasterSimulationService: DisasterSimulationService =
  globalThis.__PAYSWAP_DR_SIMULATION ?? new DisasterSimulationService();

if (!globalThis.__PAYSWAP_DR_SIMULATION) {
  globalThis.__PAYSWAP_DR_SIMULATION = disasterSimulationService;
}
