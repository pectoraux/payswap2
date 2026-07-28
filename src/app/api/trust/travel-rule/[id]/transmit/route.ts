import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { travelRuleService, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/trust/travel-rule/[id]/transmit
 *
 * Transmit a pending travel rule record to the beneficiary institution
 * (mock — always succeeds). The record's status flips to `transmitted`.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  const { id } = await params;
  const existing = travelRuleService.get(id);
  if (!existing) {
    return NextResponse.json(
      { error: 'Travel rule record not found' },
      { status: 404 },
    );
  }

  try {
    const record = await travelRuleService.transmit(id);

    await complianceAuditTrail.record({
      action: 'trust.travel_rule.transmit',
      actorId: userId ?? 'unknown',
      entityType: 'travel_rule_record',
      entityId: id,
      details: {
        transactionId: existing.transactionId,
        amount: existing.amount,
        currency: existing.currency,
        beneficiary: existing.beneficiary,
        provider: 'NOTABENE',
      },
      result: 'success',
    });

    return NextResponse.json({ record });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'transmission failed';
    const record = await travelRuleService.markFailed(id);
    await complianceAuditTrail.record({
      action: 'trust.travel_rule.transmit',
      actorId: userId ?? 'unknown',
      entityType: 'travel_rule_record',
      entityId: id,
      details: { error: reason },
      result: 'error',
    });
    return NextResponse.json(
      { error: reason, record },
      { status: 502 },
    );
  }
}
