import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sarManager } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/trust/sars
 *
 * List SARs. Optional filter: ?status=draft|filed|acknowledged|closed
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;

  const sars = sarManager.list({
    status: (status as any) ?? undefined,
  });
  const stats = sarManager.stats();

  return NextResponse.json({ sars, stats });
}

/**
 * POST /api/trust/sars
 *
 * Create a draft SAR. Body:
 *   { alertIds: string[], narrative: string,
 *     subject?: string, amount?: number, currency?: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const alertIds: string[] = Array.isArray(body?.alertIds)
    ? body.alertIds.filter((a: unknown) => typeof a === 'string' && a.trim())
    : [];
  const narrative =
    typeof body?.narrative === 'string' ? body.narrative.trim() : '';

  if (!narrative) {
    return NextResponse.json(
      { error: 'narrative is required' },
      { status: 400 },
    );
  }

  const subject = typeof body?.subject === 'string' ? body.subject : 'SAR Filing';
  const amount = typeof body?.amount === 'number' ? body.amount : 0;
  const currency = typeof body?.currency === 'string' ? body.currency : 'USD';
  const sar = await sarManager.createSAR(alertIds, subject, narrative, amount, currency, (session.user as any)?.id ?? 'unknown');

  return NextResponse.json({ sar }, { status: 201 });
}
