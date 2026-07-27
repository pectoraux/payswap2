/** GET /api/runtime/scheduler/jobs — list scheduled jobs. POST — schedule a job. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime } from '@/runtime';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ jobs: payswapRuntime.schedulingEngine.listJobs(), deadLetters: payswapRuntime.schedulingEngine.getDeadLetters() });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { operation, body: jobBody, scheduledFor, intervalMs } = body as { operation: string; body: Record<string, unknown>; scheduledFor?: number; intervalMs?: number };

  if (!operation) return NextResponse.json({ error: 'Missing operation' }, { status: 400 });

  let jobId: string;
  if (intervalMs) {
    jobId = payswapRuntime.schedulingEngine.scheduleRecurring({ operation, body: jobBody ?? {}, intervalMs });
  } else {
    jobId = payswapRuntime.schedulingEngine.schedule({ operation, body: jobBody ?? {}, scheduledFor: scheduledFor ?? payswapRuntime.clock.now() });
  }
  return NextResponse.json({ jobId }, { status: 201 });
}
