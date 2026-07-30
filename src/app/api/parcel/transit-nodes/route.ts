import { NextRequest, NextResponse } from 'next/server';
import { parcelExtService } from '@/extensions/parcel-delivery/extended-store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 7: Transit nodes — hubs, warehouses, pickup points */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const type = req.nextUrl.searchParams.get('type') as never ?? undefined;
  const nodes = parcelExtService.listTransitNodes(type);
  return NextResponse.json({ transitNodes: nodes, count: nodes.length });
}
