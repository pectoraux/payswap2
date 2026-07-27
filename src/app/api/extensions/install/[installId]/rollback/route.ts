import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extensions/install/[installId]/rollback
 *
 * Roll an installed extension back to a previous version. Body:
 *   { version: string }
 *
 * Mirrors the upgrade endpoint — the install status is set back to `enabled`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ installId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const { installId } = await params;
  const install = await db.extensionInstall.findUnique({
    where: { id: installId },
  });
  if (!install || install.merchantId !== merchantId) {
    return NextResponse.json(
      { ok: false, error: 'Install not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const version =
    typeof body.version === 'string' && body.version.trim()
      ? body.version.trim()
      : null;
  if (!version) {
    return NextResponse.json(
      { ok: false, error: 'version is required' },
      { status: 400 },
    );
  }

  await db.extension.update({
    where: { id: install.extensionId },
    data: { version },
  });

  const updated = await db.extensionInstall.update({
    where: { id: installId },
    data: { status: 'enabled' },
  });

  return NextResponse.json({ ok: true, install: updated, version });
}
