import { NextRequest, NextResponse } from 'next/server';
import { debugProof } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 7: Proof Debugger. Step through a proof tree node-by-node.
 * Set breakpoints on capability names to see exactly when/why they're chosen.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const sp = req.nextUrl.searchParams;
  const proofId = sp.get('proofId');
  const breakpoints = sp.get('breakpoints')?.split(',').filter(Boolean) ?? [];
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });

  try {
    const session = debugProof(proofId, breakpoints);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Debug failed' }, { status: 500 });
  }
}
