import { NextRequest, NextResponse } from 'next/server';
import { traceDecision, getGoals } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const sp = req.nextUrl.searchParams;
  const goalId = sp.get('goalId');
  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });

  const constraints: Record<string, unknown> = {};
  const budget = sp.get('budget'); if (budget) constraints.budget = Number(budget);
  const minTrust = sp.get('minTrust'); if (minTrust) constraints.minTrust = Number(minTrust);
  const jurisdiction = sp.get('jurisdiction'); if (jurisdiction) constraints.jurisdiction = jurisdiction;

  try {
    const trace = traceDecision(goalId, constraints as Parameters<typeof traceDecision>[1]);
    return NextResponse.json({ trace });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Trace failed' }, { status: 500 });
  }
}
