import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const auction = parcelService.startAuction(body.bundleId as string, (body.mode as 'BULK' | 'OPEN') ?? 'BULK');
  if (!auction) return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
  return NextResponse.json({ auction, message: `✓ Auction started (${auction.mode} mode, ${auction.deliveryIds.length} deliveries, revenue ${auction.estimatedRevenue.toString()})` }, { status: 201 });
}
