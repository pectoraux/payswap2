import { NextRequest, NextResponse } from 'next/server';
import { getEvents, getCurrentSeq, eventCount, verifyDisposable, stateAtSeq } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const fromSeq = sp.get('from') ? Number(sp.get('from')) : 0;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 100;
  const view = sp.get('view') ?? 'list';

  if (view === 'verify') {
    // PHASE 1.3: Verify projections are disposable — replay from events + compare to live graph
    const adminSession = await requireAdminSession();
    if (!adminSession) return forbidden();
    const result = verifyDisposable();
    return NextResponse.json({ ...result, message: result.match ? '✓ Projections are disposable — replay matches live graph' : '✗ DISCREPANCY: hidden state detected' });
  }

  if (view === 'timetravel') {
    // PHASE 7: Time-travel — graph state at a given sequence
    const seq = sp.get('seq') ? Number(sp.get('seq')) : getCurrentSeq();
    const state = stateAtSeq(seq);
    return NextResponse.json({ seq, nodeCount: state.nodes.length, relationshipCount: state.relationships.length, nodes: state.nodes.slice(0, 50), relationships: state.relationships.slice(0, 50) });
  }

  const events = getEvents(fromSeq, limit);
  return NextResponse.json({
    events: events.map((e) => ({ ...e, payload: e.payload })),
    count: events.length,
    totalEvents: eventCount(),
    currentSeq: getCurrentSeq(),
  });
}
