/**
 * POST /api/platform/simulator — run a simulation scenario.
 * GET /api/platform/simulator — get available scenarios.
 *
 * The simulator is NOT a demo. It executes exactly the same pipeline as
 * production. If the simulator routes differently from production, it is a bug.
 */

import { NextResponse } from 'next/server';
import { runtime, uid } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      scenarios: [
        { id: 'local_rail', name: 'Local Rail (same country)', fromCountry: 'KE', toCountry: 'KE', amount: 1000, currency: 'KES', senderHasReserve: true, receiverHasReserve: true, isLocal: true },
        { id: 'reserve_to_reserve', name: 'Reserve to Reserve', fromCountry: 'KE', toCountry: 'GH', amount: 500, currency: 'USD', senderHasReserve: true, receiverHasReserve: true, isLocal: false },
        { id: 'reserve_to_market', name: 'Reserve to Market', fromCountry: 'KE', toCountry: 'NG', amount: 500, currency: 'USD', senderHasReserve: true, receiverHasReserve: false, isLocal: false },
        { id: 'market_to_reserve', name: 'Market to Reserve', fromCountry: 'NG', toCountry: 'KE', amount: 500, currency: 'USD', senderHasReserve: false, receiverHasReserve: true, isLocal: false },
        { id: 'market_to_market', name: 'Market to Market', fromCountry: 'NG', toCountry: 'GH', amount: 500, currency: 'USD', senderHasReserve: false, receiverHasReserve: false, isLocal: false },
      ],
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const scenario = {
      scenarioId: body.scenarioId || uid('sim'),
      name: body.name || 'Custom Scenario',
      description: body.description || '',
      fromCountry: body.fromCountry || 'KE',
      toCountry: body.toCountry || 'GH',
      amount: body.amount || 500,
      currency: body.currency || 'USD',
      senderHasReserve: body.senderHasReserve ?? true,
      receiverHasReserve: body.receiverHasReserve ?? true,
      isLocal: body.isLocal ?? false,
      lpTimeout: body.lpTimeout,
      recipientNeverConfirms: body.recipientNeverConfirms,
      stablecoinDepeg: body.stablecoinDepeg,
      reserveDepletion: body.reserveDepletion,
      createdAt: Date.now(),
      createdBy: 'api',
    };

    const result = await runtime.platform.simulate(scenario);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
