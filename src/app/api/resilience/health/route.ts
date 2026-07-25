import { NextResponse } from 'next/server';
import { healthCheck, circuitBreakerRegistry } from '@/protocol/resilience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/resilience/health — comprehensive health check with real circuit breakers */
export async function GET() {
  const health = healthCheck();
  const status = health.overall === 'healthy' ? 200 : health.overall === 'degraded' ? 200 : 503;
  return NextResponse.json(health, { status });
}
