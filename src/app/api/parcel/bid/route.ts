import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const bid = parcelService.placeBid(body.auctionId as string, body.courierId as string, body.amount as number, body.estimatedHours as number);
  if (!bid) return NextResponse.json({ error: 'Auction not open or courier not found' }, { status: 404 });
  return NextResponse.json({ bid, message: `✓ Bid placed by ${bid.courierName}: ${bid.amount.toString()}` }, { status: 201 });
}
