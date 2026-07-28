import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  claimsService,
  type Claim,
  type ClaimType,
  type ClaimStatus,
} from '@/claims';
import {
  requireSession,
  unauthorized,
  forbidden,
  requireMerchantId,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: ClaimType[] = [
  'unauthorized_transaction',
  'duplicate_charge',
  'product_not_received',
  'product_not_as_described',
  'incorrect_amount',
  'refund_not_processed',
  'fraud',
  'settlement_failure',
  'other',
];

const VALID_STATUSES: ClaimStatus[] = [
  'open',
  'under_review',
  'approved',
  'rejected',
  'vetoed',
  'resolved',
];

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
 * GET /api/claims
 *
 * Query params:
 *   - status: filter by status
 *   - merchantId: filter by merchant
 *   - transactionId: filter by transaction
 *   - q: free-text search (description / transactionId / claimId)
 *
 * Auth: any authenticated user. The merchant-scope filter is applied
 * automatically for merchants (so they only see their own claims).
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const merchantIdParam = url.searchParams.get('merchantId');
  const transactionId = url.searchParams.get('transactionId') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  const status: ClaimStatus | undefined = statusParam
    ? (statusParam as ClaimStatus)
    : undefined;
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status filter: ${status}` },
      { status: 400 },
    );
  }

  // Resolve merchant scope — merchants only see their own claims unless they're
  // also an admin.
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  let merchantId: string | undefined = merchantIdParam ?? undefined;
  if (!isAdmin) {
    const resolvedMerchantId = await requireMerchantId();
    merchantId = resolvedMerchantId ?? undefined;
  }

  const claims = claimsService.list({
    status,
    merchantId,
    transactionId,
    q,
    claimantUserId: userId,
  });

  // For admins, list ALL claims (override the claimantUserId filter).
  let allClaims = claims;
  if (isAdmin) {
    allClaims = claimsService.list({ status, merchantId, transactionId, q });
  }

  return NextResponse.json({
    claims: allClaims.map(serializeClaim),
    overview: claimsService.overview(),
    filter: { status, merchantId, transactionId, q },
  });
}

/**
 * POST /api/claims
 *
 * Create a new claim (dispute a transaction).
 *
 * Body: { transactionId: string, type: ClaimType, description: string }
 *
 * Auth: any authenticated user (typically a merchant).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();
  const actorEmail = (session.user as any)?.email as string | undefined;
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transactionId =
    typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
  const typeRaw = typeof body?.type === 'string' ? body.type : '';
  const description =
    typeof body?.description === 'string' ? body.description.trim() : '';

  if (!transactionId) {
    return NextResponse.json(
      { error: 'transactionId is required' },
      { status: 400 },
    );
  }
  if (!VALID_TYPES.includes(typeRaw as ClaimType)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  const type: ClaimType = typeRaw as ClaimType;
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

  // Resolve merchant scope (for audit attribution).
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  let merchantId: string | undefined;
  if (!isAdmin) {
    merchantId = (await requireMerchantId()) ?? undefined;
  }

  const claim = claimsService.create({
    transactionId,
    type: type as ClaimType,
    description,
    claimantUserId: userId,
    claimantEmail: actorEmail,
    merchantId,
  });

  // Audit log.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'CLAIM_CREATED',
        resourceType: 'Claim',
        resourceId: claim.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          claimId: claim.id,
          transactionId,
          type,
          description: description.slice(0, 500),
          merchantId: merchantId ?? null,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ claim: serializeClaim(claim) }, { status: 201 });
}
