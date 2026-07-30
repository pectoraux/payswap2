import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicOS, compileIntent } from '@/economic-os';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const intentId = typeof body?.intentId === 'string' ? body.intentId : '';
  if (!intentId) return NextResponse.json({ error: 'intentId is required' }, { status: 400 });

  const intent = economicOS.getIntent(intentId);
  if (!intent) return NextResponse.json({ error: 'Intent not found' }, { status: 404 });

  const graph = compileIntent(intent);
  // store the graph so it can be executed later
  // (push to the store's graphs array via the service — we need a setter)
  pushGraph(graph);

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC_OS.COMPILED',
        resourceType: 'CompositionGraph',
        resourceId: graph.id,
        result: 'SUCCESS',
        details: JSON.stringify({ intentId, intentName: intent.name, nodes: graph.nodes.length, actors: graph.actorCount, totalCost: graph.totalCost, status: graph.status, actorEmail: actorEmail ?? null }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ graph: serializeGraph(graph) }, { status: 201 });
}

// We need a way to push graphs into the store. Import the store directly.
import { eosStore } from '@/economic-os';
function pushGraph(graph: ReturnType<typeof compileIntent>) {
  eosStore.graphs.unshift(graph);
  if (eosStore.graphs.length > 100) eosStore.graphs.length = 100;
}

function serializeGraph(g: ReturnType<typeof compileIntent>) {
  return {
    id: g.id, intentId: g.intentId, intentName: g.intentName,
    nodes: g.nodes, edges: g.edges,
    totalCost: g.totalCost, totalLatencyMs: g.totalLatencyMs, trustScore: g.trustScore,
    actorCount: g.actorCount, opportunisticCount: g.opportunisticCount,
    status: g.status, policyViolations: g.policyViolations,
    compiledAt: new Date(g.compiledAt).toISOString(),
  };
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const graphs = economicOS.listGraphs(20).map(serializeGraph);
  return NextResponse.json({ graphs, count: graphs.length });
}
