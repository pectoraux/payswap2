import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { travelRuleService } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/travel-rule/[transactionId]
 *
 * Get the travel rule record for a transaction. Returns 404 if no record
 * has been created.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { transactionId } = await params;
  const record = travelRuleService.getByTransaction(transactionId);
  if (!record) {
    return NextResponse.json(
      { error: 'No travel rule record found for this transaction' },
      { status: 404 },
    );
  }
  return NextResponse.json({ record });
}
