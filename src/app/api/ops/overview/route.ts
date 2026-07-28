import { NextResponse } from 'next/server';
import { metricsRegistry, alertManager, sloManager, systemOverview } from '@/protocol/ops';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/overview — Operations OS dashboard snapshot.
 *
 * Returns the existing system overview (KPIs, alerts, SLOs) PLUS the
 * M-OPS-42 Operations OS view: active incidents, on-call roster, upcoming
 * maintenance, pending treasury/settlement operations, active migrations
 * and open investigations.
 */
export async function GET() {
  const overview = systemOverview();
  const alerts = alertManager.active();
  let slos: unknown[] = [];
  try {
    slos = sloManager.evaluate(metricsRegistry);
  } catch {
    slos = [];
  }

  // Operations OS snapshot (all parallel + best-effort — no single domain
  // failure should break the overview).
  const [
    activeIncidents,
    incidentStats,
    onCallRoster,
    upcomingMaintenance,
    activeMaintenance,
    pendingTreasuryOps,
    pendingSettlementOps,
    failedSettlements,
    activeMigrations,
    plannedMigrations,
    openInvestigations,
  ] = await Promise.all([
    opsEngine.incidents.list({ status: 'open' }).catch(() => []),
    opsEngine.incidents.getStats().catch(() => ({
      total: 0,
      open: 0,
      bySeverity: {},
      avgResolutionTimeMs: 0,
    })),
    opsEngine.onCall.getActiveRoster().catch(() => ({})),
    opsEngine.maintenance.getUpcoming().catch(() => []),
    opsEngine.maintenance.getActive().catch(() => null),
    opsEngine.treasury.getPending().catch(() => []),
    opsEngine.settlement.list({ status: 'pending' }).catch(() => []),
    opsEngine.settlement.getFailedSettlements().catch(() => []),
    (async () => {
      const m = await opsEngine.migrations.getActive().catch(() => null);
      return m ? [m] : [];
    })(),
    opsEngine.migrations.list({ status: 'planned' }).catch(() => []),
    opsEngine.investigations
      .list({ status: 'in_progress' })
      .catch(() => []),
  ]);

  return NextResponse.json({
    // Existing system overview (preserved for back-comat with the current
    // dashboard card).
    overview,
    alerts,
    slos,
    // M-OPS-42 Operations OS view.
    ops: {
      activeIncidents,
      incidentStats,
      onCallRoster,
      upcomingMaintenance,
      activeMaintenance,
      pendingTreasuryOps,
      pendingSettlementOps,
      failedSettlements,
      activeMigrations,
      plannedMigrations,
      openInvestigations,
    },
    ts: Date.now(),
  });
}
