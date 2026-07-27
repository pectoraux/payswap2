/** GET /api/runtime/inspector/graphs/resource — Resource Graph view. Read-only. */
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
  const view = await payswapRuntime.inspector.getResourceGraph(env);
  return NextResponse.json(view);
}
