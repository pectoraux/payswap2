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
 * POST /api/extensions/install/[installId]/upgrade
 *
 * Upgrade an installed extension to a new version. Body:
 *   { version: string }
 *
 * Sets status to `enabled` after the upgrade so the extension resumes
 * processing events with the new code.
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

  // Update the extension's published version (in a real platform the runtime
  // would have multiple versions stored; for this demo we bump the version on
  // the extension itself).
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
