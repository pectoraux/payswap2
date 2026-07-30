import { NextRequest, NextResponse } from 'next/server';
import { parcelExtService } from '@/extensions/parcel-delivery/extended-store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 9: Learning — EKG memory feeds (route reliability, courier reliability, hub congestion) */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const view = req.nextUrl.searchParams.get('view') ?? 'summary';
  if (view === 'records') {
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
    return NextResponse.json({ records: parcelExtService.listLearning(limit) });
  }
  return NextResponse.json({ summary: parcelExtService.getLearningSummary() });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const record = parcelExtService.recordLearning(
    body.type as never, body.entityId as string, body.entityName as string,
    body.metric as string, body.value as number, body.context as Record<string, unknown>,
  );
  return NextResponse.json({ record, message: '✓ Learning record stored — planner will use this for future decisions' }, { status: 201 });
}
