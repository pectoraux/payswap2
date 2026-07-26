/** DELETE /api/runtime/scheduler/jobs/[id] — cancel a scheduled job. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime } from '@/runtime';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const cancelled = payswapRuntime.schedulingEngine.cancel(id);
  return NextResponse.json({ cancelled });
}
