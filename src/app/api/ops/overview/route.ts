import { NextResponse } from 'next/server';
import { metricsRegistry, alertManager, sloManager, systemOverview } from '@/protocol/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/overview — system KPIs, active alerts, SLO status */
export async function GET() {
  const overview = systemOverview();
  const alerts = alertManager.active();
  let slos: unknown[] = [];
  try { slos = sloManager.evaluate(metricsRegistry); } catch { slos = []; }
  return NextResponse.json({ overview, alerts, slos, ts: Date.now() });
}
