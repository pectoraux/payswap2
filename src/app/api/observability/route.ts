import { NextResponse } from 'next/server';
import { structuredLogger, redMetrics, sloTracker } from '@/protocol/observability/structured-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/observability
 *
 * OPS-4: Observability dashboard data.
 *
 * Returns:
 *   - Structured logs (recent, with paymentId correlation)
 *   - RED metrics per tier (Rate, Errors, Duration)
 *   - SLO status (authorization latency, settlement success rate, burn rate)
 *
 * "Why was this payment slow?" is answerable from this endpoint + the logs.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('paymentId');
  const logsLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);

  // If paymentId is provided, return logs for that payment only.
  if (paymentId) {
    const paymentLogs = structuredLogger.forPayment(paymentId);
    return NextResponse.json({
      paymentId,
      logs: paymentLogs,
      logCount: paymentLogs.length,
      ts: Date.now(),
    });
  }

  // Otherwise return the full observability dashboard.
  return NextResponse.json({
    logs: structuredLogger.recent(logsLimit),
    redMetrics: redMetrics.allTierMetrics(),
    sloStatus: sloTracker.getStatus(),
    summary: {
      totalLogs: structuredLogger.recent(1).length,
      tierCount: redMetrics.allTierMetrics().length,
      sloCount: sloTracker.getStatus().length,
      healthySLOs: sloTracker.getStatus().filter(s => s.status === 'healthy').length,
      breachedSLOs: sloTracker.getStatus().filter(s => s.status === 'breached').length,
      ts: Date.now(),
    },
  });
}
