import { NextRequest, NextResponse } from 'next/server';
import { loyaltyService } from '@/extensions/loyalty/store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { customerId: string } }) {
  const balance = loyaltyService.getBalance(params.customerId);
  if (!balance) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  return NextResponse.json(balance);
}
