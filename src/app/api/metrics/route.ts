import { NextRequest, NextResponse } from 'next/server';
import { collectRealMetrics, toPrometheusText } from '@/lib/real-metrics';

/**
 * P4-2 (H-7): Real operational metrics.
 *
 * PREVIOUSLY this endpoint ran `protocolScenarios()` (20 simulations)
 * + `fuzz(100)` synchronously on every request — a self-inflicted DOS
 * surface that returned synthetic numbers, not real telemetry. That
 * code is GONE.
 *
 * NOW this endpoint returns real signals collected by
 * `collectRealMetrics()`:
 *   - process: memory / CPU / uptime / event-loop lag
 *   - db: SELECT 1 round-trip latency + health
 *   - eventStore: count + lastSeq from the persisted event log
 *   - backups: count + latest backup metadata (P4-1 durability signal)
 *   - slo: every SLO's current value + on-track status (RED-aligned)
 *   - metricsRegistry: the live Prometheus-style counters/histograms
 *
 * Query params:
 *   - `?format=prometheus` → Prometheus text exposition format (for
 *     monitoring scrapers). Equivalent to GET /api/metrics/prometheus.
 *
 * Auth: this route is NOT in `PUBLIC_ROUTES` (see `src/middleware.ts`)
 * — it requires a session token. Monitoring systems should scrape
 * with a Bearer token. The dedicated
 * `/api/metrics/prometheus` route is also auth-gated for consistency
 * with `/api/ops/metrics`; if you want a public scrape endpoint, add
 * `/api/metrics/prometheus` to `PUBLIC_ROUTES` in `src/middleware.ts`.
 *
 * APM wiring: see the module comment in `src/lib/real-metrics.ts` —
 * installing OpenTelemetry or Datadog is a production config change
 * (no code change to this route required). The JSON shape returned
 * here is already structured for APM export (standard RED metrics
 * names: rate / errors / duration).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/metrics — real operational metrics (JSON, or Prometheus text via ?format=prometheus). */
export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const format = url.searchParams.get('format');

  const snapshot = await collectRealMetrics();

  if (format === 'prometheus') {
    return new Response(toPrometheusText(snapshot), {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
