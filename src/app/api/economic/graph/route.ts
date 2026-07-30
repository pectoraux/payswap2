import { NextRequest, NextResponse } from 'next/server';
import { economicEngine } from '@/economic';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const graph = economicEngine.buildGraph();
  return NextResponse.json({
    nodes: graph.nodes,
    edges: graph.edges,
    counts: {
      extensions: graph.nodes.filter((n) => n.kind === 'EXTENSION').length,
      tokens: graph.nodes.filter((n) => n.kind === 'TOKEN').length,
      events: graph.nodes.filter((n) => n.kind === 'EVENT').length,
      pipelines: graph.nodes.filter((n) => n.kind === 'PIPELINE').length,
      edges: graph.edges.length,
    },
  });
}
