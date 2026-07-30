import { NextRequest, NextResponse } from 'next/server';
import { parcelExtService } from '@/extensions/parcel-delivery/extended-store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 6: Bundle optimization with wait-time — "Can this order wait 15 minutes?" */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const deliveryIds = Array.isArray(body.deliveryIds) ? body.deliveryIds as string[] : [];
  const maxWaitMinutes = typeof body.maxWaitMinutes === 'number' ? body.maxWaitMinutes : 15;
  if (deliveryIds.length === 0) return NextResponse.json({ error: 'deliveryIds is required' }, { status: 400 });
  try {
    const result = parcelExtService.optimizeBundleWithWait(deliveryIds, maxWaitMinutes);
    return NextResponse.json({
      result,
      message: `✓ Bundle optimization: waited ${result.waitedMinutes}min → ${result.additionalDeliveriesJoined} more joined → savings ${result.costSavings.toString()} + ${result.carbonSavings}kg CO₂`,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Optimization failed' }, { status: 500 });
  }
}
