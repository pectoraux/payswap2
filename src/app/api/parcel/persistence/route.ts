import { NextRequest, NextResponse } from 'next/server';
import { getEventCount, rebuildAllProjections, verifyReconstructible, readStream } from '@/extensions/parcel-delivery/persistence';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') ?? 'stats';
  if (view === 'stats') {
    return NextResponse.json({ eventCount: getEventCount() });
  }
  if (view === 'rebuild') {
    const result = rebuildAllProjections();
    return NextResponse.json({ ...result, message: `✓ Rebuilt ${result.streamsRebuilt} streams from ${result.eventsReplayed} events in ${result.durationMs}ms` });
  }
  if (view === 'verify') {
    const streamId = sp.get('streamId') ?? '';
    if (!streamId) return NextResponse.json({ error: 'streamId required for verify view' }, { status: 400 });
    return NextResponse.json(verifyReconstructible(streamId));
  }
  if (view === 'stream') {
    const streamId = sp.get('streamId') ?? '';
    if (!streamId) return NextResponse.json({ error: 'streamId required for stream view' }, { status: 400 });
    return NextResponse.json({ events: readStream(streamId) });
  }
  return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
}
