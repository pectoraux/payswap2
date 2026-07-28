import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { kycService } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/kyc
 *
 * List KYC/KYB verifications. Optional filters:
 *   ?type=kyc|kyb
 *   ?status=pending|in_review|approved|rejected|expired
 *   ?entityId=<id>
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const entityId = url.searchParams.get('entityId') ?? undefined;

  const verifications = kycService.list({
    type: (type as any) ?? undefined,
    status: (status as any) ?? undefined,
    entityId: entityId ?? undefined,
  });
  const stats = kycService.stats();

  return NextResponse.json({ verifications, stats });
}
