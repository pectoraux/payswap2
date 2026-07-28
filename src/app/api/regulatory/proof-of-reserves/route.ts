import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { proofOfReservesService } from '@/lib/proof-of-reserves';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const proof = await proofOfReservesService.generate();
  return NextResponse.json({ ok: true, proof });
}
