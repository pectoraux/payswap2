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
 * POST /api/extensions/install/[installId]/enable
 *
 * Re-enable a previously-disabled extension install for the calling merchant.
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

  const updated = await db.extensionInstall.update({
    where: { id: installId },
    data: { status: 'enabled' },
  });

  return NextResponse.json({ ok: true, install: updated });
}
