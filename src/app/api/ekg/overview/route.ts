import { NextResponse } from 'next/server';
import { ekg, listProofs, getOverviewExtra } from '@/ekg';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const base = ekg.overview();
  const extra = getOverviewExtra();
  return NextResponse.json({ overview: { ...base, ...extra } });
}
