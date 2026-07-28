import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sanctionsScreener } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/sanctions
 *
 * List sanctions screenings. Optional filter: ?status=pending|true_positive|false_positive|review
 *                              ?entityId=<id>
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
  const status = url.searchParams.get('status') ?? undefined;
  const entityId = url.searchParams.get('entityId') ?? undefined;

  const screenings = sanctionsScreener.list({
    status: (status as any) ?? undefined,
  });
  const stats = sanctionsScreener.stats();

  return NextResponse.json({ screenings, stats });
}
