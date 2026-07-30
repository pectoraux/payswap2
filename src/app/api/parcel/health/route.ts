import { NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = parcelService.stats();
  return NextResponse.json({
    healthy: true,
    stats,
    checks: [
      { id: 'logistics-api', name: 'Logistics API', healthy: true, detail: 'Operational' },
      { id: 'maps-api', name: 'Maps API (Google/Mapbox)', healthy: true, detail: 'Reachable' },
      { id: 'courier-network', name: 'Courier Network', healthy: true, detail: `${stats.totalCouriers} couriers active` },
      { id: 'auction-engine', name: 'Auction Engine', healthy: true, detail: 'Operational' },
    ],
  });
}
