import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  claimsService,
  type VoteChoice,
} from '@/claims';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_VOTES: VoteChoice[] = ['support', 'reject'];

/**
 * POST /api/claims/[id]/vote
 *
 * Cast (or update) a community vote on a claim.
 *
 * Body: { vote: 'support' | 'reject', comment?: string }
 *
 * Auth: any authenticated user. One vote per user (subsequent votes replace
 * the previous one).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();
  const actorEmail = (session.user as any)?.email as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Claim id is required' }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const voteRaw = typeof body?.vote === 'string' ? body.vote : '';
  const comment =
    typeof body?.comment === 'string' ? body.comment.trim() : undefined;

  if (!VALID_VOTES.includes(voteRaw as VoteChoice)) {
    return NextResponse.json(
      { error: `vote must be one of: ${VALID_VOTES.join(', ')}` },
      { status: 400 },
    );
  }
  const vote: VoteChoice = voteRaw as VoteChoice;
  if (comment && comment.length > 2000) {
    return NextResponse.json(
      { error: 'comment must be ≤ 2000 chars' },
      { status: 400 },
    );
  }

  const claim = claimsService.get(id);
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }
  if (claim.status === 'resolved' || claim.status === 'vetoed') {
    return NextResponse.json(
      { error: `Cannot vote on a ${claim.status} claim` },
      { status: 409 },
    );
  }

  const voteRecord = claimsService.castVote(id, {
    vote,
    comment,
    voterUserId: userId,
    voterEmail: actorEmail,
  });
  if (!voteRecord) {
    return NextResponse.json(
      { error: 'Failed to cast vote' },
      { status: 500 },
    );
  }

  // Audit log.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'CLAIM_VOTE_CAST',
        resourceType: 'Claim',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          claimId: id,
          voteId: voteRecord.id,
          vote,
          comment: comment ?? null,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    vote: voteRecord,
    tally: claimsService.tally(id),
  });
}
