import { NextRequest, NextResponse } from 'next/server';
import { eventStore } from '@/protocol/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/persistence/events — list persisted events (paginated) */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const sinceSeq = url.searchParams.get('sinceSeq') !== null ? Number(url.searchParams.get('sinceSeq')) : undefined;
  const types = url.searchParams.get('types')?.split(',').filter(Boolean);

  const { events, lastSeq } = await eventStore.loadEvents({
    sinceSeq,
    limit: Math.min(limit, 1000),
    types: types && types.length > 0 ? types : undefined,
  });

  return NextResponse.json({ events, lastSeq, count: events.length });
}

/** POST /api/persistence/events — flush pending events to DB */
export async function POST() {
  const { persisted } = await eventStore.flush();
  return NextResponse.json({ persisted, lastSeq: eventStore.currentSeq() });
}
