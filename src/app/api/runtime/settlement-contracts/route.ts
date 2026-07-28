import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { settlementContractEngine } from '@/runtime/liquidity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const lpId = url.searchParams.get('lpId') || undefined;
  return NextResponse.json({ ok: true, contracts: settlementContractEngine.list({ status: status as any, lpId }) });
}
