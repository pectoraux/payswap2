import { NextResponse } from 'next/server';
import { economicOS } from '@/economic-os';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json({ overview: economicOS.overview() });
}
