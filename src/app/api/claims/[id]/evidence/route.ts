import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  claimsService,
  type EvidenceType,
} from '@/claims';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: EvidenceType[] = [
  'text',
  'file_reference',
  'screenshot',
  'transaction_log',
  'communication',
  'other',
];

/**
 * POST /api/claims/[id]/evidence
 *
 * Submit evidence for a claim.
 *
 * Body: { type: EvidenceType, description: string, reference?: string }
 *
 * Auth: any authenticated user.
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

  const typeRaw = typeof body?.type === 'string' ? body.type : '';
  const description =
    typeof body?.description === 'string' ? body.description.trim() : '';
  const reference =
    typeof body?.reference === 'string' ? body.reference.trim() : undefined;

  if (!VALID_TYPES.includes(typeRaw as EvidenceType)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  const type: EvidenceType = typeRaw as EvidenceType;
  if (!description) {
    return NextResponse.json(
      { error: 'description is required' },
      { status: 400 },
    );
  }
  if (description.length > 5000) {
    return NextResponse.json(
      { error: 'description must be ≤ 5000 chars' },
      { status: 400 },
    );
  }
  if (reference && reference.length > 2048) {
    return NextResponse.json(
      { error: 'reference must be ≤ 2048 chars' },
      { status: 400 },
    );
  }

  const claim = claimsService.get(id);
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }
  if (claim.status === 'resolved') {
    return NextResponse.json(
      { error: 'Cannot submit evidence on a resolved claim' },
      { status: 409 },
    );
  }

  const evidence = claimsService.submitEvidence(id, {
    type,
    description,
    reference,
    submittedByUserId: userId,
    submittedByEmail: actorEmail,
  });
  if (!evidence) {
    return NextResponse.json(
      { error: 'Failed to submit evidence' },
      { status: 500 },
    );
  }

  // Audit log.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'CLAIM_EVIDENCE_SUBMITTED',
        resourceType: 'Claim',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          claimId: id,
          evidenceId: evidence.id,
          type,
          description: description.slice(0, 500),
          reference: reference ?? null,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ evidence }, { status: 201 });
}
