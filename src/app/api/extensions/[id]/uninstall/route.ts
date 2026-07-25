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
 * POST /api/extensions/[id]/uninstall
 *
 * Remove an installed extension from the authenticated merchant. Decrements
 * the extension's installCount when the install was genuinely new.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const existing = await db.extensionInstall.findUnique({
    where: { extensionId_merchantId: { extensionId: id, merchantId } },
  });
  if (!existing) {
    // Idempotent: nothing to uninstall.
    return NextResponse.json({ ok: true, removed: false });
  }

  await db.extensionInstall.delete({ where: { id: existing.id } });

  // Decrement the install counter (clamp at 0).
  const ext = await db.extension.findUnique({
    where: { id },
    select: { installCount: true },
  });
  if (ext && ext.installCount > 0) {
    await db.extension.update({
      where: { id },
      data: { installCount: { decrement: 1 } },
    });
  }

  return NextResponse.json({ ok: true, removed: true });
}
