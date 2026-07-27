/** GET /api/runtime/inspector/recommendations/[id]/provenance — full provenance chain. Read-only. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const env = (url.searchParams.get('environment') ?? 'sandbox') as Environment;
  const provenance = await payswapRuntime.inspector.getRecommendationProvenance(id, env);
  return NextResponse.json(provenance);
}
