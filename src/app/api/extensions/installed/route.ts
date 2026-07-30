import { NextRequest, NextResponse } from 'next/server';
import { listInstalled } from '@/extension-platform';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const tenantId = sp.get('tenantId') ?? 'default';
  const installed = listInstalled(tenantId);
  return NextResponse.json({ installed, count: installed.length });
}
