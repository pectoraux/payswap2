import { NextRequest, NextResponse } from 'next/server';
import { platform } from '@/economic-platform';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const session = await requireSession(); if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const view = sp.get('view') ?? 'records';
  if (view === 'learning') {
    return NextResponse.json({ learning: platform.listLearningScores(), count: platform.listLearningScores().length });
  }
  const memory = platform.listMemory(limit).map((m) => ({ ...m, executedAt: new Date(m.executedAt).toISOString() }));
  return NextResponse.json({ memory, count: memory.length });
}
