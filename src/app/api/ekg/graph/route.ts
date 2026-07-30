import { NextRequest, NextResponse } from 'next/server';
import { ekg, graph } from '@/ekg';
import type { NodeKind } from '@/ekg';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const time = sp.get('at') ? Number(sp.get('at')) : undefined;
  const kind = sp.get('kind') ?? undefined;

  if (time) {
    // Temporal query — return graph state at time T
    const state = ekg.stateAt(time);
    return NextResponse.json({ nodes: state.nodes, relationships: state.relationships, counts: { nodes: state.nodes.length, relationships: state.relationships.length }, at: new Date(time).toISOString() });
  }

  const nodes = ekg.listNodes(kind ? { kind: kind as NodeKind } : undefined);
  const allRels = graph.relationships.filter((r) => !r.validTo);
  return NextResponse.json({ nodes, relationships: allRels, counts: { nodes: nodes.length, relationships: allRels.length } });
}
