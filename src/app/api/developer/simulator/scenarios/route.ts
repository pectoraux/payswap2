import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { DEVELOPER_SCENARIOS } from '@/lib/developer-scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/simulator/scenarios
 *
 * Returns the list of pre-built simulator scenarios.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    scenarios: DEVELOPER_SCENARIOS.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      category: s.category,
    })),
  });
}
