import { NextRequest, NextResponse } from 'next/server';
import { parcelExtService } from '@/extensions/parcel-delivery/extended-store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 12: Merchant Dashboard — orders, auctions, bundles, routes, analytics, costs, carbon */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const merchantId = req.nextUrl.searchParams.get('merchantId') ?? (session.user as { id?: string }).id ?? 'default';
  const dashboard = parcelExtService.getDashboard(merchantId);
  return NextResponse.json({ dashboard });
}
