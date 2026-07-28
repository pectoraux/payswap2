import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { bandwidthEngine } from '@/runtime/liquidity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json({ ok: true, positions: bandwidthEngine.listAll() });
}
