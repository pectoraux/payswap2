import { NextRequest, NextResponse } from 'next/server';
import { eventStore } from '@/protocol/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/persistence/status — persistence layer status */
export async function GET() {
  const [count, types] = await Promise.all([
    eventStore.count(),
    eventStore.typeDistribution(),
  ]);
  return NextResponse.json({
    eventCount: count,
    lastSeq: eventStore.currentSeq(),
    typeDistribution: types,
    durability: count > 0 ? 'persistent' : 'volatile',
    ts: Date.now(),
  });
}
