/**
 * POST /api/sdk/capabilities/invoke — invoke a capability method.
 *
 * Admin-only. Body: { capabilityId: string, method: string, args?: unknown }
 *
 * Looks up the capability in the registry → finds the providing plugin →
 * looks up the method on the plugin module → runs it via the sandbox (with
 * timeout + try/catch + failure tracking).
 *
 * Returns { ok, capabilityId, method, pluginId, result?, error?, durationMs }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { sdk } from '@/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')) return forbidden();

  let body: { capabilityId?: string; method?: string; args?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Body must be valid JSON' },
      { status: 400 },
    );
  }

  const capabilityId = (body.capabilityId ?? '').toString();
  const method = (body.method ?? '').toString();
  const args = body.args ?? {};

  if (!capabilityId || !method) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Body must include { capabilityId, method }',
      },
      { status: 400 },
    );
  }

  const result = await sdk.invoke(capabilityId, method, args);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        capabilityId,
        method,
        pluginId: result.pluginId,
        error: result.error,
        durationMs: result.durationMs,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    capabilityId,
    method,
    pluginId: result.pluginId,
    result: result.result,
    durationMs: result.durationMs,
  });
}
