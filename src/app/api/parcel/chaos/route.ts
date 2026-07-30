import { NextResponse } from 'next/server';
import { runChaosTests } from '@/extensions/parcel-delivery/chaos-tests';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const report = runChaosTests();
  return NextResponse.json(report);
}
