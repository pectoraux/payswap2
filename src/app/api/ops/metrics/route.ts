import { NextResponse } from 'next/server';
import { metricsRegistry } from '@/protocol/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/metrics — Prometheus text exposition format */
export async function GET() {
  const text = metricsRegistry.expose();
  return new NextResponse(text, {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}

/** GET /api/ops/metrics?format=json — JSON snapshot */
export async function POST() {
  return NextResponse.json(metricsRegistry.json());
}
