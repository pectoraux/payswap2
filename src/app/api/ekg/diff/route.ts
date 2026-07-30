import { NextRequest, NextResponse } from 'next/server';
import { diffGraph, getCurrentSeq } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 7: Graph Diff Viewer. Compare graph state at two sequence numbers.
 * Shows what nodes/relationships were added/removed/versioned between them.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const sp = req.nextUrl.searchParams;
  const fromSeq = sp.get('from') ? Number(sp.get('from')) : 0;
  const toSeq = sp.get('to') ? Number(sp.get('to')) : getCurrentSeq();

  const diff = diffGraph(fromSeq, toSeq);
  return NextResponse.json({ ...diff, message: `${diff.summary.totalChanges} changes between seq ${fromSeq} and seq ${toSeq}` });
}
