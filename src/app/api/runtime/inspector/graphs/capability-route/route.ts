/** GET /api/runtime/inspector/graphs/capability-route — Capability/Route Graph view. Read-only. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime } from '@/runtime';
export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const view = await payswapRuntime.inspector.getCapabilityRouteGraph();
  return NextResponse.json(view);
}
