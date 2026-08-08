import { collectRealMetrics, toPrometheusText } from '@/lib/real-metrics';

/**
 * P4-2 (H-7): Prometheus text exposition endpoint.
 *
 * Returns the same snapshot as `/api/metrics?format=prometheus` but
 * as a dedicated route — most Prometheus scrape configs prefer a
 * distinct URL path over a query param.
 *
 * Auth: this route is NOT in `PUBLIC_ROUTES` (see `src/middleware.ts`)
 * — it requires a session token, matching the existing
 * `/api/ops/metrics` route. Monitoring systems should scrape with a
 * Bearer token. If you want a public scrape endpoint, add this path
 * to `PUBLIC_ROUTES` in `src/middleware.ts`.
 *
 * Content-Type: `text/plain; version=0.0.4; charset=utf-8` (the
 * standard Prometheus exposition format version).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/metrics/prometheus — Prometheus text exposition format. */
export async function GET(): Promise<Response> {
  const snapshot = await collectRealMetrics();
  return new Response(toPrometheusText(snapshot), {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
