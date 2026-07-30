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
    const customer = crmService.createCustomer({
      id: body.id as string | undefined,
      name: body.name as string,
      email: body.email as string,
      phone: body.phone as string | undefined,
      company: body.company as string | undefined,
      value: body.value as number | undefined,
      tags: body.tags as string[] | undefined,
      owner: body.owner as string | undefined,
      stage: body.stage as never,
    });
    return NextResponse.json({ customer, message: `✓ Created customer ${customer.name} (stage: ${customer.stage})` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
