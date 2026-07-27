/**
 * POST /api/runtime/recommendations/[id]/transition — transition a recommendation's lifecycle.
 * (M-RT-10.) Validates legal transitions. Emits one domain event.
 * Does NOT perform the implementation — that's an actor's responsibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment, type LifecycleState, IllegalTransitionError } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: recommendationId } = await params;
  const body = await req.json();
  const { to, reason, data, environment } = body as {
    to: LifecycleState;
    reason: string;
    data?: Record<string, unknown>;
    environment?: Environment;
  };

  if (!to || !reason) {
    return NextResponse.json({ error: 'Missing required fields: to, reason' }, { status: 400 });
  }

  const correlationId = `rec_lifecycle_${Date.now().toString(36)}`;

  try {
    // Special case: if 'to' is 'detected', use detect() (first registration).
    if (to === 'detected') {
      const state = await payswapRuntime.recLifecycle.detect(
        recommendationId, reason,
        environment ?? 'sandbox',
        (session.user as { id: string }).id,
        correlationId,
      );
      return NextResponse.json({ state, correlationId }, { status: 201 });
    }

    const state = await payswapRuntime.recLifecycle.transition(
      recommendationId, to, reason,
      environment ?? 'sandbox',
      (session.user as { id: string }).id,
      correlationId,
      data,
    );

    return NextResponse.json({ state, correlationId });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return NextResponse.json({
        error: 'Illegal transition',
        recommendationId: err.recommendationId,
        from: err.from,
        to: err.to,
      }, { status: 422 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
