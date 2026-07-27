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
 * POST /api/extensions/install/[installId]/uninstall
 *
 * Permanently remove an installed extension. Decrements the extension's
 * installCount so marketplace stats stay accurate.
 */
export async function POST(
  _req: NextRequest,
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

  await db.extensionInstall.delete({ where: { id: installId } });

  // Decrement the install counter (clamp at 0).
  const ext = await db.extension.findUnique({
    where: { id: install.extensionId },
    select: { installCount: true },
  });
  if (ext && ext.installCount > 0) {
    await db.extension.update({
      where: { id: install.extensionId },
      data: { installCount: { decrement: 1 } },
    });
  }

  return NextResponse.json({ ok: true, removed: true });
}
