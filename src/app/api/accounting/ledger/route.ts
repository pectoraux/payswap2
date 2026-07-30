import { NextRequest, NextResponse } from 'next/server';
import { accountingService } from '@/extensions/accounting/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const accountId = req.nextUrl.searchParams.get('accountId') ?? undefined;
  const from = req.nextUrl.searchParams.get('from') ? Number(req.nextUrl.searchParams.get('from')) : undefined;
  const to = req.nextUrl.searchParams.get('to') ? Number(req.nextUrl.searchParams.get('to')) : undefined;
  const entries = accountingService.getLedger({ accountId, from, to });
  const accounts = accountingService.listAccounts();
  const balances = accounts.map((a) => ({ account: a, balance: accountingService.getAccountBalance(a.id).toJSON() }));
  return NextResponse.json({ entries, count: entries.length, accounts, balances });
}
