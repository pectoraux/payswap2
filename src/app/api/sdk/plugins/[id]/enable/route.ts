/**
 * POST /api/sdk/plugins/[id]/enable — enable a plugin.
 *
 * Admin-only. Calls loader.enable(id) which:
 *   1. Verifies dependencies are enabled
 *   2. Calls the plugin's onEnable lifecycle hook (sandboxed)
 *   3. Registers capabilities in the CapabilityRegistry
 *   4. Sets status to 'enabled'
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
    await sdk.enable(id);
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
      enabledAt: record.enabledAt ?? null,
      error: record.error ?? null,
    },
  });
}
