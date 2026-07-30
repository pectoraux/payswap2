import { NextResponse } from 'next/server';
import { economicEngine } from '@/economic-engine';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const goals = economicEngine.listGoals();
  return NextResponse.json({ goals, count: goals.length });
}
