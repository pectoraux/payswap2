import { NextRequest, NextResponse } from 'next/server';
import { crmService } from '@/extensions/crm/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const stage = req.nextUrl.searchParams.get('stage') as never | null;
  const customers = crmService.listCustomers(stage ?? undefined);
  return NextResponse.json({ customers, count: customers.length, stats: crmService.stats() });
}
