import { NextRequest, NextResponse } from 'next/server';
import { economicEngine } from '@/economic';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeEvent(e: ReturnType<typeof economicEngine.listEvents>[number]) {
  return { ...e, ts: new Date(e.ts).toISOString() };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? undefined;
  const source = sp.get('source') ?? undefined;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 100;
  const events = economicEngine.listEvents({ type, source, limit }).map(serializeEvent);
  return NextResponse.json({ events, count: events.length });
}
