import { NextRequest, NextResponse } from 'next/server';
import { parcelExtService } from '@/extensions/parcel-delivery/extended-store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 5, 7: Multi-hop route planning — Merchant → Hub → Hub → Customer */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const deliveryIds = Array.isArray(body.deliveryIds) ? body.deliveryIds as string[] : [];
  const priority = (body.priority as 'FASTEST' | 'CHEAPEST' | 'SAFEST' | 'CARBON_OPTIMIZED') ?? 'CHEAPEST';
  if (deliveryIds.length === 0) return NextResponse.json({ error: 'deliveryIds is required' }, { status: 400 });
  try {
    const route = parcelExtService.planMultiHopRoute(deliveryIds, priority);
    return NextResponse.json({
      route,
      message: `✓ Multi-hop route planned: ${route.hops.length} hops via ${route.transitNodesUsed.length} transit nodes (${route.vehicleType}, ${route.totalDistanceKm}km, ${route.estimatedDurationHours}h, ${route.estimatedCost.toString()}, ${route.estimatedCarbon.toFixed(2)}kg CO₂)`,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Planning failed' }, { status: 500 });
  }
}
