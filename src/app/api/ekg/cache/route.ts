import { NextResponse } from 'next/server';
import { getCacheStats, invalidateProofsForNode } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const stats = await getCacheStats();
  return NextResponse.json({ stats });
}

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const count = await invalidateProofsForNode('all');
  return NextResponse.json({ invalidated: count, message: `✓ Invalidated ${count} cached proofs` });
}
