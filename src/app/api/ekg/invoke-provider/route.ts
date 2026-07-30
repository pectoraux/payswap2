import { NextRequest, NextResponse } from 'next/server';
import { getAdapter, ensureAdaptersSeeded } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 6: Invoke a real-world provider adapter. This calls the adapter's
 * invoke() method, which in production makes real HTTP calls to Stripe/Ecobank/
 * Smile ID/MTN MoMo. Here it uses the mock implementation.
 *
 * The result includes exact Money (no float) — demonstrating that financial
 * correctness is real throughout the execution path.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  ensureAdaptersSeeded();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const adapterId = typeof body?.adapterId === 'string' ? body.adapterId : '';
  const capabilityId = typeof body?.capabilityId === 'string' ? body.capabilityId : '';
  const inputs = (body?.inputs && typeof body.inputs === 'object' ? body.inputs : {}) as Record<string, unknown>;

  if (!adapterId) return NextResponse.json({ error: 'adapterId is required' }, { status: 400 });
  if (!capabilityId) return NextResponse.json({ error: 'capabilityId is required' }, { status: 400 });

  const adapter = getAdapter(adapterId);
  if (!adapter) return NextResponse.json({ error: 'Adapter not found' }, { status: 404 });
  if (!adapter.enabled) return NextResponse.json({ error: 'Adapter is disabled' }, { status: 409 });

  const result = await adapter.invoke(capabilityId, inputs);

  return NextResponse.json({
    adapterId,
    adapterName: adapter.name,
    capabilityId,
    success: result.success,
    producedAssets: result.producedAssets.map((a) => ({ assetId: a.assetId, amount: a.amount.toJSON() })),
    consumedAssets: result.consumedAssets.map((a) => ({ assetId: a.assetId, amount: a.amount.toJSON() })),
    cost: result.cost.toJSON(),
    latencyMs: result.latencyMs,
    detail: result.detail,
    error: result.error,
    rawResponse: result.rawResponse,
    message: result.success
      ? `✓ ${adapter.name} invoked successfully — cost ${result.cost.toString()} (exact Money, no float)`
      : `✗ ${adapter.name} invocation failed: ${result.error}`,
  }, { status: 201 });
}
