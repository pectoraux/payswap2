import { NextRequest, NextResponse } from 'next/server';
import { loyaltyService } from '@/extensions/loyalty/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const customerId = body.customerId as string;
    // Auto-register if customer doesn't exist
    const existing = loyaltyService.getBalance(customerId);
    if (!existing) {
      loyaltyService.registerCustomer({
        id: customerId,
        name: (body.customerName as string) ?? `Customer ${customerId.slice(-4)}`,
        email: (body.customerEmail as string) ?? `${customerId}@payswap.dev`,
      });
    }
    const result = loyaltyService.awardPoints({
      customerId,
      points: body.points as number,
      reason: (body.reason as string) ?? 'manual',
      referenceId: body.referenceId as string | undefined,
    });
    return NextResponse.json({
      customer: result.customer,
      award: result.award,
      tierUpgraded: result.tierUpgraded,
      newTier: result.newTier,
      message: `✓ Awarded ${result.award.points} pts to ${result.customer.name} (balance: ${result.customer.points})`,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
