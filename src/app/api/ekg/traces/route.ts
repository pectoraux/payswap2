import { NextRequest, NextResponse } from 'next/server';
import { getTrace, listTraces } from '@/ekg';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const traceId = sp.get('traceId');
  if (traceId) {
    const trace = await getTrace(traceId);
    if (!trace) return NextResponse.json({ error: 'Trace not found' }, { status: 404 });
    return NextResponse.json({ trace });
  }
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 20;
  const traces = await listTraces(limit);
  return NextResponse.json({ traces, count: traces.length });
}
