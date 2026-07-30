import { NextRequest, NextResponse } from 'next/server';
import { economicOS } from '@/economic-os';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as 'CURRENCY' | 'CLAIM' | 'CREDENTIAL' | 'RIGHT' | 'RESERVATION' | 'DEBT' | 'EQUITY' | 'INSURANCE' | 'REPUTATION' | 'CAPABILITY' | 'BANDWIDTH' | 'LICENSE' | 'EVIDENCE' | 'RECEIPT' | null;
  const assets = economicOS.listAssets(type ? { type } : undefined);
  return NextResponse.json({ assets, count: assets.length });
}
