import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { settlementContractEngine } from '@/runtime/liquidity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  let body: any = {};
  try { body = await req.json(); } catch {}
  const lpId = body.lpId || (session.user as any)?.id;
  const contract = settlementContractEngine.claim(id, lpId);
  if (!contract) return NextResponse.json({ ok: false, error: 'Cannot claim' }, { status: 400 });
  return NextResponse.json({ ok: true, contract });
}
