import { NextRequest, NextResponse } from 'next/server';
import { listAdapters, getAdapter, setAdapterEnabled, ensureAdaptersSeeded } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 6: Provider registry. List registered real-world providers (adapters),
 * view their offers, enable/disable them.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Ensure adapters are seeded (idempotent)
  ensureAdaptersSeeded();

  const sp = req.nextUrl.searchParams;
  const adapterId = sp.get('id');

  if (adapterId) {
    const adapter = getAdapter(adapterId);
    if (!adapter) return NextResponse.json({ error: 'Adapter not found' }, { status: 404 });
    const health = await adapter.healthCheck();
    return NextResponse.json({
      adapter: {
        id: adapter.id, name: adapter.name, label: adapter.label,
        description: adapter.description, enabled: adapter.enabled,
        jurisdictions: adapter.jurisdictions, carbonPerInvocation: adapter.carbonPerInvocation,
        offers: adapter.offers.map((o) => ({
          capabilityId: o.capabilityId,
          pricePerInvocation: o.pricePerInvocation.toJSON(),
          latencyMs: o.latencyMs, slaSuccessRate: o.slaSuccessRate,
          capacity: o.capacity, region: o.region,
        })),
      },
      health,
    });
  }

  const adapters = listAdapters();
  return NextResponse.json({
    providers: adapters.map((a) => ({
      id: a.id, name: a.name, label: a.label, description: a.description,
      enabled: a.enabled, jurisdictions: a.jurisdictions,
      carbonPerInvocation: a.carbonPerInvocation,
      offerCount: a.offers.length,
      offers: a.offers.map((o) => ({
        capabilityId: o.capabilityId,
        price: o.pricePerInvocation.toString(),
        latencyMs: o.latencyMs,
        slaSuccessRate: o.slaSuccessRate,
        region: o.region,
      })),
    })),
    count: adapters.length,
    message: `${adapters.length} real-world providers registered. Each implements the ProviderAdapter interface and participates in the capability graph as an entity.`,
  });
}

/** Enable/disable a provider. */
export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = typeof body?.id === 'string' ? body.id : '';
  const enabled = typeof body?.enabled === 'boolean' ? body.enabled : null;
  if (!id || enabled === null) return NextResponse.json({ error: 'id and enabled are required' }, { status: 400 });

  const ok = setAdapterEnabled(id, enabled);
  if (!ok) return NextResponse.json({ error: 'Adapter not found' }, { status: 404 });
  return NextResponse.json({ id, enabled, message: `Provider ${id} ${enabled ? 'enabled' : 'disabled'}` });
}
