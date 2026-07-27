import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import {
  resolveDeveloperMerchantId,
} from '@/lib/developer-context';
import { getOrCreateDeveloperSandbox } from '@/lib/developer-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/sandbox
 *
 * Returns the developer's personal sandbox state. Creates one on first call.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }
  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    const sandbox = getOrCreateDeveloperSandbox(userId, merchantId);
    return NextResponse.json({ ok: true, sandbox });
  } catch (err) {
    console.error('[api/developer/sandbox GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/developer/sandbox — seed additional test data into the sandbox.
 *
 * Body: { customers?: number, products?: number, payments?: number, invoices?: number }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }
  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    const sandbox = getOrCreateDeveloperSandbox(userId, merchantId);
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { sandboxService } = await import('@/protocol/developer');
    const result = (sandboxService as any).seedTestData(sandbox.id, {
      customers: typeof body.customers === 'number' ? body.customers : 5,
      products: typeof body.products === 'number' ? body.products : 8,
      payments: typeof body.payments === 'number' ? body.payments : 10,
      invoices: typeof body.invoices === 'number' ? body.invoices : 4,
    });
    return NextResponse.json({ ok: true, seeded: result });
  } catch (err) {
    console.error('[api/developer/sandbox POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
