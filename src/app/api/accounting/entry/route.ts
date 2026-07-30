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
    const entry = accountingService.recordEntry({
      date: body.date as number | undefined,
      description: body.description as string,
      lines: body.lines as never,
      reference: body.reference as string | undefined,
      source: (body.source as never) ?? 'manual',
    });
    return NextResponse.json({
      entry,
      message: `✓ Recorded ${entry.entryNumber} — total ${entry.total.toString()}`,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
