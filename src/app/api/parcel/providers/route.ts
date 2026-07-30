import { NextResponse } from 'next/server';
import { parcelProviderAdapters } from '@/extensions/parcel-delivery/extended-store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

/** Milestone 11: Provider adapters — Uber, Bolt, Glovo, FedEx, DHL, UPS */
export async function GET() {
  return NextResponse.json({
    providers: parcelProviderAdapters.map((a) => ({
      id: a.id, name: a.name, label: a.label, description: a.description,
      enabled: a.enabled, jurisdictions: a.jurisdictions, carbonPerInvocation: a.carbonPerInvocation,
    })),
    count: parcelProviderAdapters.length,
    message: `${parcelProviderAdapters.length} delivery provider adapters registered (Uber, Bolt, Glovo, FedEx, DHL, UPS). Each implements ProviderAdapter and participates in the capability graph.`,
  });
}
