import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/marketplace/[id]/install
 *
 * Install a published marketplace plugin for the authenticated merchant.
 * The merchant must grant every permission the plugin declares.
 *
 * Body (optional): { permissionsGranted?: string[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const granted: string[] = Array.isArray(body.permissionsGranted)
    ? body.permissionsGranted.filter((p: unknown) => typeof p === 'string')
    : [];

  try {
    // Verify the plugin is a marketplace plugin (not a legacy extension).
    const extension = await db.extension.findUnique({ where: { id } });
    if (!extension) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = JSON.parse(extension.config ?? '{}');
    if (meta?.marketplace !== true) {
      return NextResponse.json(
        { ok: false, error: 'Not a marketplace plugin' },
        { status: 400 },
      );
    }

    const result = await pluginCatalog.install(id, merchantId, granted);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, install: result }, { status: 201 });
  } catch (err) {
    console.error('[api/marketplace/[id]/install POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
