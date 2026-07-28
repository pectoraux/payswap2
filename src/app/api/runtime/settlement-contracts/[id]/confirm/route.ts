import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { settlementContractEngine } from '@/runtime/liquidity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  const contract = settlementContractEngine.confirm(id);
  if (!contract) return NextResponse.json({ ok: false, error: 'Cannot confirm' }, { status: 400 });
  const released = settlementContractEngine.release(id);
  if (released) settlementContractEngine.close(id);
  return NextResponse.json({ ok: true, contract: settlementContractEngine.get(id) });
}
