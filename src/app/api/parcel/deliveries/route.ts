import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const merchantId = req.nextUrl.searchParams.get('merchantId') ?? (session.user as { id?: string }).id;
  const deliveries = parcelService.listDeliveries(merchantId ?? undefined);
  return NextResponse.json({ deliveries, count: deliveries.length, stats: parcelService.stats() });
}
