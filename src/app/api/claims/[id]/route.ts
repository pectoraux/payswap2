import { NextRequest, NextResponse } from 'next/server';
import {
  claimsService,
  type Claim,
} from '@/claims';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeClaim(c: Claim) {
  return {
    ...c,
    createdAt: new Date(c.createdAt).toISOString(),
    updatedAt: new Date(c.updatedAt).toISOString(),
    resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : null,
    evidence: c.evidence.map((e) => ({
      ...e,
      submittedAt: new Date(e.submittedAt).toISOString(),
    })),
    votes: c.votes.map((v) => ({
      ...v,
      votedAt: new Date(v.votedAt).toISOString(),
    })),
    resolution: c.resolution
      ? {
          ...c.resolution,
          resolvedAt: new Date(c.resolution.resolvedAt).toISOString(),
        }
      : null,
  };
}

/**
 * GET /api/claims/[id]
 *
 * Fetch a single claim by ID (with evidence + votes + resolution).
 *
 * Auth: any authenticated user.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Claim id is required' }, { status: 400 });
  }

  const claim = claimsService.get(id);
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  return NextResponse.json({
    claim: serializeClaim(claim),
    tally: claimsService.tally(id),
  });
}
