import { NextResponse } from 'next/server';
import { platform } from '@/economic-platform';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await requireSession(); if (!session) return unauthorized();
  const graph = platform.buildGraph();
  return NextResponse.json({ ...graph, counts: { nodes: graph.nodes.length, edges: graph.edges.length } });
}
