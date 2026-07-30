import { NextRequest, NextResponse } from 'next/server';
import { accountingService } from '@/extensions/accounting/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const rec = accountingService.reconcile({
      accountId: body.accountId as string,
      periodStart: body.periodStart as number,
      periodEnd: body.periodEnd as number,
      statementBalance: body.statementBalance as number,
      notes: body.notes as string | undefined,
    });
    return NextResponse.json({
      reconciliation: rec,
      message: rec.status === 'MATCHED'
        ? '✓ Reconciliation matched — books are accurate'
        : `⚠ Discrepancy of ${rec.difference.toString()}`,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
