import { NextRequest, NextResponse } from 'next/server';
import { economicEngine } from '@/economic-engine';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const view = sp.get('view') ?? 'entries';

  if (view === 'cooperation') {
    return NextResponse.json({ cooperation: economicEngine.listCooperation() });
  }
  if (view === 'strategies') {
    return NextResponse.json({ strategies: economicEngine.listStrategyEffectiveness() });
  }
  if (view === 'reliability') {
    return NextResponse.json({ reliability: economicEngine.listOrganizationReliability() });
  }

  const memory = economicEngine.listMemory(limit).map((m) => ({
    ...m, executedAt: new Date(m.executedAt).toISOString(),
  }));
  return NextResponse.json({ memory, count: memory.length });
}
