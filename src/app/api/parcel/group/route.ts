import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const bundles = parcelService.discoverBundles();
  return NextResponse.json({ bundles, count: bundles.length, message: `✓ Discovered ${bundles.length} grouping opportunities` }, { status: 201 });
}
