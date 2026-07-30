import { NextRequest, NextResponse } from 'next/server';
import { accountingService } from '@/extensions/accounting/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const now = Date.now();
  const defaultFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const from = req.nextUrl.searchParams.get('from') ? Number(req.nextUrl.searchParams.get('from')) : defaultFrom;
  const to = req.nextUrl.searchParams.get('to') ? Number(req.nextUrl.searchParams.get('to')) : now;
  const report = accountingService.generatePnL(from, to);
  return NextResponse.json({ report });
}
