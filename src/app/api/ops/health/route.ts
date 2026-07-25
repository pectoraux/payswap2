import { NextResponse } from 'next/server';
import { healthCheck } from '@/protocol/resilience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/health — comprehensive health check (k8s probe) */
export async function GET() {
  const health = healthCheck();
  const status = health.overall === 'healthy' ? 200 : health.overall === 'degraded' ? 200 : 503;
  return NextResponse.json(health, { status });
}
