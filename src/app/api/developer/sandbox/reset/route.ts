import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import {
  resolveDeveloperMerchantId,
} from '@/lib/developer-context';
import { getOrCreateDeveloperSandbox, resetDeveloperSandbox } from '@/lib/developer-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/developer/sandbox/reset
 *
 * Clears all test data (customers, products, payments, invoices) from the
 * developer's sandbox and re-seeds the initial fixtures. API keys and
 * connectors are preserved.
 */
export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }
  try {
    // Ensure the sandbox exists (creates one if not — idempotent for first call).
    const merchantId = await resolveDeveloperMerchantId(userId);
    getOrCreateDeveloperSandbox(userId, merchantId);
    const sandbox = resetDeveloperSandbox(userId);
    return NextResponse.json({ ok: true, sandbox });
  } catch (err) {
    console.error('[api/developer/sandbox/reset] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
