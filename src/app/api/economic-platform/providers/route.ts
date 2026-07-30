import { NextRequest, NextResponse } from 'next/server';
import { platform } from '@/economic-platform';
import type { ProviderKind } from '@/economic-platform';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const session = await requireSession(); if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') as ProviderKind | null;
  const offersCapability = sp.get('offersCapability') ?? undefined;
  const providers = platform.listProviders({ kind: kind ?? undefined, offersCapability });
  return NextResponse.json({ providers, count: providers.length });
}
