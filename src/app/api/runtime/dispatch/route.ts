/**
 * POST /api/runtime/dispatch — dispatch a command through the runtime.
 *
 * SEC-1 FIX: This route previously had NO authentication — it accepted
 * {type, payload, metadata} from anyone and executed it against the runtime.
 * The gateway at /api/runtime/gateway/dispatch does this correctly with
 * getServerSession. This route now requires the same.
 *
 * SEC-3 FIX: The 400 response previously included the full list of registered
 * command types — a free API map for an attacker. Now returns a generic 400.
 *
 * Body: { type, payload, metadata }
 *   - type: e.g., "payment.create", "refund.create", "reserve.lock"
 *   - payload: command-specific data
 *   - metadata: { actor, environment, correlationId, source }
 *
 * Auth: requires a valid session. The session's user ID and role override
 * whatever the caller puts in metadata.actor.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtimeHost } from '@/runtime';
import type { RuntimeCommand } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // SEC-1: require authentication.
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { type, payload, metadata } = body;

    if (!type || !payload || !metadata) {
      return NextResponse.json(
        { ok: false, error: 'Required: { type, payload, metadata }' },
        { status: 400 },
      );
    }

    // Check if the command type is registered.
    // SEC-3: do NOT enumerate registered types in the response.
    const runtime = (await import('@/runtime')).runtime;
    if (!runtime.commands.has(type)) {
      return NextResponse.json(
        { ok: false, error: 'Unknown command type' },
        { status: 400 },
      );
    }

    // Override metadata.actor with the session's identity — the caller
    // cannot impersonate another user.
    const command: RuntimeCommand = {
      type,
      payload,
      metadata: {
        ...metadata,
        actor: {
          id: (session.user as { id: string }).id,
          role: (session.user as { roles?: string[] }).roles?.[0] ?? 'merchant',
        },
      },
    };

    const hostResult = await runtimeHost.execute(command);

    return NextResponse.json({
      ok: hostResult.success,
      success: hostResult.success,
      commandType: hostResult.commandType,
      entityId: hostResult.entityId,
      events: hostResult.events,
      message: hostResult.message,
      error: hostResult.error,
      transactionId: hostResult.transactionId,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

/**
 * GET: health check only. SEC-3: does NOT list command types.
 * Returns a simple "reachable" flag for monitoring.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    reachable: true,
  });
}
