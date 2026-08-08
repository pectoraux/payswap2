/**
 * /healthz — container health check endpoint (C-8 fix).
 *
 * Docker/Kubernetes HEALTHCHECK hits this route every 30s. It verifies
 * real dependencies (database reachability), not just process liveness.
 *
 * Returns 200 + { status: 'ok', db: 'up', ts } when healthy.
 * Returns 503 + { status: 'degraded', db: 'down', error } when a dependency is down.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: { db: 'up' | 'down'; error?: string } = {
    db: 'down',
  };

  // Verify DB reachability with a trivial query.
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = 'up';
  } catch (err) {
    checks.error = err instanceof Error ? err.message : String(err);
    checks.db = 'down';
  }

  const healthy = checks.db === 'up';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      ...checks,
      ts: Date.now(),
    },
    { status: healthy ? 200 : 503 },
  );
}
