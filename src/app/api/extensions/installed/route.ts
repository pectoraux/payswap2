import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { safeJson } from '@/lib/extension-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/extensions/installed?merchantId=...
 *
 * List all installs for a merchant (defaults to the calling merchant when
 * merchantId is omitted). Each install is joined with its parent extension.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const url = new URL(req.url);
  const explicitMerchantId = url.searchParams.get('merchantId');

  const merchantId = explicitMerchantId ?? (await requireMerchantId());
  if (!merchantId) return forbidden();

  // Allow admins to query any merchant's installs.
  if (explicitMerchantId) {
    const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
    const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
    const ownMerchantId = await requireMerchantId();
    if (!isAdmin && ownMerchantId !== explicitMerchantId) {
      return forbidden();
    }
  }

  const installs = await db.extensionInstall.findMany({
    where: { merchantId },
    include: { extension: true },
    orderBy: { installedAt: 'desc' },
  });

  const decorated = installs.map((i) => ({
    id: i.id,
    extensionId: i.extensionId,
    merchantId: i.merchantId,
    status: i.status,
    config: safeJson<Record<string, unknown>>(i.config),
    installedAt: i.installedAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    extension: {
      id: i.extension.id,
      slug: i.extension.slug,
      name: i.extension.name,
      description: i.extension.description,
      category: i.extension.category,
      iconUrl: i.extension.iconUrl,
      version: i.extension.version,
      status: i.extension.status,
      permissions: safeJson<string[]>(i.extension.permissions) ?? [],
      pricing: i.extension.pricing,
      price: i.extension.price,
      config: safeJson<Record<string, unknown>>(i.extension.config),
      developerId: i.extension.developerId,
      installCount: i.extension.installCount,
      rating: i.extension.rating,
      reviewCount: i.extension.reviewCount,
    },
  }));

  return NextResponse.json({ ok: true, installs: decorated, count: decorated.length });
}
