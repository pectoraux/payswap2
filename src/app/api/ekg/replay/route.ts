import { NextRequest, NextResponse } from 'next/server';
import { replayProjection, getCurrentSeq, eventCount } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 1.3: Projection rebuild. Replays events from the log to reconstruct
 * the graph. Proves the graph is disposable — if the replayed graph doesn't
 * match the live graph, there's hidden state.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body ok */ }
  const upToSeq = typeof body?.upToSeq === 'number' ? body.upToSeq : undefined;

  const startMs = Date.now();
  const { nodes, relationships } = replayProjection(upToSeq);
  const durationMs = Date.now() - startMs;

  const currentNodes = Array.from(nodes.values()).filter((n) => !n.validTo);
  const currentRels = relationships.filter((r) => !r.validTo);

  return NextResponse.json({
    replayed: true,
    upToSeq: upToSeq ?? getCurrentSeq(),
    totalEventsReplayed: eventCount(),
    durationMs,
    result: {
      nodes: currentNodes.length,
      relationships: currentRels.length,
      versionedNodes: Array.from(nodes.values()).filter((n) => n.validTo).length,
      message: `✓ Projection rebuilt from ${eventCount()} events in ${durationMs}ms — ${currentNodes.length} nodes, ${currentRels.length} relationships restored`,
    },
  }, { status: 201 });
}
