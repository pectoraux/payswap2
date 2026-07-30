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
    const result = loyaltyService.redeemPoints({
      customerId: body.customerId as string,
      points: body.points as number,
      reason: (body.reason as string) ?? 'redeem',
    });
    return NextResponse.json({
      customer: result.customer,
      award: result.award,
      message: `✓ Redeemed ${result.award.points * -1} pts (balance: ${result.customer.points})`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
