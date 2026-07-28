import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { generateEconomy, getEconomyStats } from '@/simulation/economy';
import { SCENARIO_LIBRARY } from '@/simulation/scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const economy = generateEconomy();
  const stats = getEconomyStats(economy);
  return NextResponse.json({
    ok: true,
    economy: stats,
    scenarios: SCENARIO_LIBRARY.map((s) => ({
      type: s.type, name: s.name, description: s.description,
      triggerDay: s.triggerDay, severity: s.severity,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: { days?: number } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const days = Math.min(Math.max(body.days ?? 30, 1), 120);
  const { runSimulation } = await import('@/simulation/runner');
  const result = await runSimulation(days);
  return NextResponse.json({ ok: true, ...result });
}
