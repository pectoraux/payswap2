import { NextRequest, NextResponse } from 'next/server';
import { economicOS } from '@/economic-os';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const produces = sp.get('produces') ?? undefined;
  const region = sp.get('region') ?? undefined;
  const capabilities = economicOS.listCapabilities({ produces, region });
  return NextResponse.json({ capabilities, count: capabilities.length });
}
