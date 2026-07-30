import { NextRequest, NextResponse } from 'next/server';
import { crmService } from '@/extensions/crm/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const followUp = crmService.createFollowUp({
      customerId: body.customerId as string,
      type: body.type as never,
      subject: body.subject as string,
      note: body.note as string | undefined,
      dueAt: body.dueAt as number,
      assigneeId: body.assigneeId as string | undefined,
      createdFrom: body.createdFrom as never,
      referenceId: body.referenceId as string | undefined,
    });
    return NextResponse.json({ followUp, message: `✓ Scheduled follow-up "${followUp.subject}"` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
