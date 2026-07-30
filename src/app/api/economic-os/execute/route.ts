import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicOS, eosStore, settleGraph } from '@/economic-os';
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
  const graphId = typeof body?.graphId === 'string' ? body.graphId : '';
  if (!graphId) return NextResponse.json({ error: 'graphId is required' }, { status: 400 });

  const graph = economicOS.getGraph(graphId) ?? eosStore.graphs.find((g) => g.id === graphId);
  if (!graph) return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  if (graph.status === 'settled') return NextResponse.json({ error: 'Graph already settled' }, { status: 409 });

  const exec = settleGraph(graph);
  eosStore.settlements.unshift(exec);
  if (eosStore.settlements.length > 100) eosStore.settlements.length = 100;

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC_OS.SETTLED',
        resourceType: 'SettlementExecution',
        resourceId: exec.id,
        result: exec.status === 'SETTLED' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ graphId, intentName: exec.intentName, steps: exec.steps.length, totalRevenue: exec.totalRevenue, totalCost: exec.totalCost, status: exec.status, actorEmail: actorEmail ?? null }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ execution: serializeExec(exec) }, { status: 201 });
}

function serializeExec(e: ReturnType<typeof settleGraph>) {
  return {
    id: e.id, graphId: e.graphId, intentId: e.intentId, intentName: e.intentName,
    steps: e.steps.map((s) => ({ ...s, ts: new Date(s.ts).toISOString() })),
    status: e.status, totalRevenue: e.totalRevenue, totalCost: e.totalCost,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
    durationMs: e.durationMs,
  };
}
