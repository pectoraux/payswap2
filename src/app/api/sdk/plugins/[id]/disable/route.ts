/**
 * POST /api/sdk/plugins/[id]/disable — disable a plugin.
 *
 * Admin-only. Calls loader.disable(id) which:
 *   1. Calls the plugin's onDisable lifecycle hook (sandboxed)
 *   2. Unregisters capabilities from the CapabilityRegistry
 *   3. Sets status to 'disabled'
 *
 * Returns the updated plugin record.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { sdk } from '@/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')) return forbidden();

  const { id } = await params;
  if (!sdk.get(id)) {
    return NextResponse.json(
      { ok: false, error: `Plugin "${id}" not registered` },
      { status: 404 },
    );
  }

  try {
    await sdk.disable(id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const record = sdk.get(id)!;
  return NextResponse.json({
    ok: true,
    plugin: {
      id: record.id,
      status: record.status,
      disabledAt: record.disabledAt ?? null,
      error: record.error ?? null,
    },
  });
}
