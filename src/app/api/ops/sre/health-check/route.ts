import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { healthCheck } from '@/protocol/resilience';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * GET /api/ops/sre/health-check
 *
 * Aggregated system health summary used by the SRE console's "Run Health
 * Check" dialog. Pulls together:
 *   - Node process metrics (memory, uptime, event-loop estimate)
 *   - Resilience layer's overall health check
 *   - Connector registry health
 *   - DB counts (events, payments, audit logs)
 *
 * Requires OPERATIONS or ADMIN role.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const mem = process.memoryUsage();
  const uptimeSec = process.uptime();
  const memUsedMb = mem.rss / 1024 / 1024;
  const heapUsedMb = mem.heapUsed / 1024 / 1024;
  const heapTotalMb = mem.heapTotal / 1024 / 1024;

  // Event-loop lag estimate — measure the delay between two immediate
  // timers. This is a rough, single-sample proxy for loop saturation.
  const loopLagMs = await new Promise<number>((resolve) => {
    const start = Date.now();
    setImmediate(() => resolve(Date.now() - start));
  });

  const resilience = healthCheck();
  const connectors = productionConnectorRegistry.all();
  const healthReport = await productionConnectorRegistry.healthReport();
  const healthyCount = healthReport.filter((h) => h.healthy).length;

  const [eventCount, paymentCount, auditCount, failedDeliveries] =
    await Promise.all([
      db.eventRecord.count(),
      db.payment.count(),
      db.auditLog.count(),
      db.webhookDelivery.count({ where: { status: 'FAILED' } }),
    ]);

  const memoryPct = Math.min(100, (memUsedMb / 1024) * 100);
  const heapPct = heapTotalMb > 0 ? (heapUsedMb / heapTotalMb) * 100 : 0;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    process: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: formatUptime(uptimeSec),
      uptimeSeconds: Math.round(uptimeSec),
      memory: {
        rssMb: Math.round(memUsedMb),
        heapUsedMb: Math.round(heapUsedMb),
        heapTotalMb: Math.round(heapTotalMb),
        memoryPct: Math.round(memoryPct * 10) / 10,
        heapPct: Math.round(heapPct * 10) / 10,
      },
      eventLoopLagMs: loopLagMs,
    },
    resilience,
    connectors: {
      total: connectors.length,
      healthy: healthyCount,
      degraded: healthReport.length - healthyCount,
      report: healthReport,
    },
    database: {
      events: eventCount,
      payments: paymentCount,
      auditLogs: auditCount,
      failedWebhookDeliveries: failedDeliveries,
    },
  });
}
