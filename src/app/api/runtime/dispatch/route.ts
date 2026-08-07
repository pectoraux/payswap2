/**
 * POST /api/runtime/dispatch — dispatch a command through the runtime.
 * (M-RT-21, Runtime Enforcement.)
 *
 * This is the ONLY way to mutate financial state in PaySwap.
 *
 * Body: { command: { type, payload, metadata } }
 *   - type: e.g., "payment.create", "refund.create", "reserve.lock"
 *   - payload: command-specific data
 *   - metadata: { actor, environment, correlationId, source }
 *
 * Returns: DispatchResult with success/failure + timing metrics + events.
 *
 * Pipeline:
 *   Command → Handler.handle() → events[] → InvariantEngine.verify()
 *   → if pass: EventStore.append() → projections auto-update → return result
 *   → if fail: return error (no events appended)
 */

import { NextResponse } from 'next/server';
import { runtime, runtimeHost } from '@/runtime';
import type { RuntimeCommand } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
    if (!runtime.commands.has(type)) {
      return NextResponse.json(
        { ok: false, error: `Unknown command type: ${type}. Registered types: ${runtime.commands.types().join(', ')}` },
        { status: 400 },
      );
    }

    const command: RuntimeCommand = { type, payload, metadata };
    // NO CONTAMINATION FIX: route through runtimeHost.execute() so the
    // command goes to the isolated runtime for its environment (sandbox or
    // live), not the shared bare `runtime` singleton.
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

/** GET: list all registered command types. */
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      commandTypes: runtime.commands.types(),
      count: runtime.commands.types().length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
