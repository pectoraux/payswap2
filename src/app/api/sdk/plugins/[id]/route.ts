/**
 * GET /api/sdk/plugins/[id] — plugin detail (full manifest + sandbox state).
 *
 * Admin-only. Returns the complete plugin record + the manifest + a snapshot
 * of the plugin's KV store + recent failure count.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { sdk } from '@/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')) return forbidden();

  const { id } = await params;
  const record = sdk.get(id);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: `Plugin "${id}" not registered` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    plugin: {
      id: record.id,
      status: record.status,
      version: record.version,
      enabledAt: record.enabledAt ?? null,
      disabledAt: record.disabledAt ?? null,
      error: record.error ?? null,
      failureCount: sdk.sandbox.getFailureCount(record.id),
      store: sdk.storeSnapshot(record.id),
    },
    manifest: record.manifest,
  });
}
