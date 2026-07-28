import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/extensions/[id]/installs
 *
 * Admin-only. Returns the install history for an extension across all
 * merchants (used in the admin detail drawer).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const { id } = await params;
  const installs = await db.extensionInstall.findMany({
    where: { extensionId: id },
    include: {
      merchant: { select: { id: true, name: true } },
    },
    orderBy: { installedAt: 'desc' },
  });

  return NextResponse.json({
    ok: true,
    installs: installs.map((i) => ({
      id: i.id,
      merchantId: i.merchantId,
      merchantName: i.merchant?.name ?? '—',
      status: i.status,
      installedAt: i.installedAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
  });
}
