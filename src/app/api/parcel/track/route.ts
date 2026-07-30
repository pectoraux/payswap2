import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const trackingId = req.nextUrl.searchParams.get('trackingId') ?? req.nextUrl.pathname.split('/').pop() ?? '';
  const events = parcelService.getTracking(trackingId);
  const delivery = parcelService.getDeliveryByTracking(trackingId);
  return NextResponse.json({ trackingId, delivery, events, count: events.length });
}
