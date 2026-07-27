/**
 * GET /api/runtime/routes — list compiled routes. (M-RT-6.)
 * READ-ONLY. The Route Graph is a compiled projection — rebuild from Capability Graph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const rebuild = url.searchParams.get('rebuild') === 'true';

  // Optionally rebuild the Route Graph from the current Capability Graph.
  if (rebuild) {
    const routeGraph = payswapRuntime.routeCompiler.rebuild(
      payswapRuntime.capabilityGraph,
      payswapRuntime.clock.now(),
    );
    return NextResponse.json({
      routes: routeGraph.routes,
      count: routeGraph.routes.length,
      note: 'Route Graph rebuilt from the Capability Graph. It is a compiled projection — connectivity only, no economics.',
    });
  }

  // Default: return the current in-memory routes (may be empty until rebuilt).
  // Rebuild on-the-fly for the query.
  const routeGraph = payswapRuntime.routeCompiler.rebuild(
    payswapRuntime.capabilityGraph,
    payswapRuntime.clock.now(),
  );
  return NextResponse.json({
    routes: routeGraph.routes,
    count: routeGraph.routes.length,
  });
}
