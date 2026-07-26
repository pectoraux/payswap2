/**
 * /api/runtime/capabilities — the Capability Graph API. (M-RT-2.)
 *
 * GET    — list capabilities (optionally filtered by lpId or from→to)
 * POST   — publish a capability (admin only)
 * DELETE — withdraw a capability (admin only)
 *
 * This is the first runtime API surface. It exercises the real
 * CapabilityGraphService (event-emitting), proving the M-RT-2 exit criteria.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, seedCapabilitiesFromKernel, type Environment } from '@/runtime';
import { defaultScenario } from '@/kernel';

export const dynamic = 'force-dynamic';

/** GET /api/runtime/capabilities — list capabilities. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const lpId = url.searchParams.get('lpId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let capabilities;
  if (lpId) {
    capabilities = payswapRuntime.capabilityGraphService.forLP(lpId);
  } else if (from && to) {
    capabilities = payswapRuntime.capabilityGraphService.canMove(from, to);
  } else {
    capabilities = payswapRuntime.capabilityGraphService.all();
  }

  return NextResponse.json({
    capabilities,
    count: capabilities.length,
  });
}

/** POST /api/runtime/capabilities — publish a capability (admin only). */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await req.json();
  const { lpId, from, to, rail, maxAmount, latencyMs, environment } = body as {
    lpId: string;
    from: string;
    to: string;
    rail: 'mobile_money' | 'bank' | 'card' | 'stablecoin' | 'blockchain';
    maxAmount: number;
    latencyMs: number;
    environment?: Environment;
  };

  if (!lpId || !from || !to || !rail || !maxAmount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const correlationId = `cap_${Date.now().toString(36)}`;
  const capability = await payswapRuntime.capabilityGraphService.publish(
    { lpId, from, to, rail, maxAmount, latencyMs: latencyMs ?? 5000 },
    environment ?? 'sandbox',
    (session.user as { id: string }).id,
    correlationId,
  );

  return NextResponse.json({ capability, correlationId }, { status: 201 });
}

/** DELETE /api/runtime/capabilities?id=... — withdraw a capability (admin only). */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const url = new URL(req.url);
  const capabilityId = url.searchParams.get('id');
  if (!capabilityId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const correlationId = `cap_del_${Date.now().toString(36)}`;
  await payswapRuntime.capabilityGraphService.withdraw(
    capabilityId,
    'sandbox',
    (session.user as { id: string }).id,
    correlationId,
  );

  return NextResponse.json({ withdrawn: capabilityId });
}

/** PUT /api/runtime/capabilities — seed from kernel LP data (admin only). */
export async function PUT() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  // Seed from the kernel's default scenario LPs.
  const scenario = defaultScenario();
  const { capabilities } = seedCapabilitiesFromKernel(scenario.liquidityProviders, 'sandbox');

  const correlationId = `cap_seed_${Date.now().toString(36)}`;
  const published: import('@/runtime').LPCapability[] = [];
  for (const cap of capabilities) {
    const result = await payswapRuntime.capabilityGraphService.publish(
      cap,
      'sandbox',
      (session.user as { id: string }).id,
      correlationId,
    );
    published.push(result);
  }

  return NextResponse.json({
    seeded: published.length,
    capabilities: published,
    correlationId,
  });
}
