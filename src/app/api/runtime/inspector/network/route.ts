/** GET /api/runtime/inspector/network — high-level network overview. Read-only. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const env = (url.searchParams.get('environment') ?? 'sandbox') as Environment;
  const overview = await payswapRuntime.inspector.getNetworkOverview(env);
  return NextResponse.json(overview);
}
