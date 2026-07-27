/**
 * /api/runtime/capabilities — the Capability Graph API. (M-RT-2, refactored.)
 *
 * THE DISCIPLINE: the Capability Graph is a compiled projection. You CANNOT
 * POST a capability to it — capabilities are derived by the CapabilityCompiler
 * from source-of-truth inputs (LP profiles, connectors, compliance). The API
 * only allows:
 *   GET  /capabilities              — list (optionally filtered)
 *   GET  /capabilities/query        — structured query (from→to, owner, rail)
 *   POST /compiler/rebuild-capabilities — trigger a compiler rebuild
 *
 * To change capabilities, change the source-of-truth inputs (LP profiles,
 * connectors, compliance rules) — the graph recompiles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, compilerInputFromKernel } from '@/runtime';
import { defaultScenario } from '@/kernel';

export const dynamic = 'force-dynamic';

/** GET /api/runtime/capabilities — list capabilities (compiled projection). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const ownerId = url.searchParams.get('ownerId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  // /capabilities/query → structured query
  const isQuery = url.searchParams.get('query') === 'true';

  let capabilities;
  if (ownerId) {
    capabilities = payswapRuntime.capabilityGraph.forOwner(ownerId);
  } else if (from && to) {
    capabilities = payswapRuntime.capabilityGraph.canMove(from, to);
  } else {
    capabilities = payswapRuntime.capabilityGraph.all();
  }

  if (isQuery) {
    return NextResponse.json({
      query: { ownerId, from, to },
      results: capabilities,
      count: capabilities.length,
      compiledAt: capabilities[0]?.compiledAt ?? null,
    });
  }

  return NextResponse.json({
    capabilities,
    count: capabilities.length,
    note: 'This is a compiled projection. To change capabilities, update LP profiles / connectors / compliance rules and rebuild.',
  });
}

/**
 * POST /api/runtime/capabilities — rebuild the graph from source-of-truth inputs.
 * (Admin only. This is "POST /compiler/rebuild-capabilities".)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  // M-RT-2 transitional: read the body for source-of-truth inputs, or seed from kernel.
  let body: { seedFromKernel?: boolean; input?: import('@/runtime').CapabilityCompilerInput } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let input: import('@/runtime').CapabilityCompilerInput;
  if (body.seedFromKernel) {
    const scenario = defaultScenario();
    input = compilerInputFromKernel(scenario.liquidityProviders);
  } else if (body.input) {
    input = body.input;
  } else {
    return NextResponse.json({
      error: 'Provide { seedFromKernel: true } or { input: {...} }',
    }, { status: 400 });
  }

  // Rebuild via the compiler.
  const compiledAt = payswapRuntime.clock.now();
  const capabilities = payswapRuntime.capabilityCompiler.rebuild(
    payswapRuntime.capabilityGraph,
    input,
    compiledAt,
  );

  return NextResponse.json({
    rebuilt: true,
    compiledAt,
    capabilityCount: capabilities.length,
    note: 'Capability Graph rebuilt from source-of-truth inputs. The graph is a compiled projection.',
  });
}
