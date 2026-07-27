import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { safeJson } from '@/lib/extension-catalog';
import { getFeaturedIds } from '@/lib/extension-featured';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/extensions
 *
 * Admin-only. Returns ALL extensions (regardless of status) with developer,
 * install count, review count and featured flag. Query params:
 *   status — single status filter
 *   q      — search name + slug + developer email
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const url = new URL(req.url);
  const status = url.searchParams.get('status')?.toLowerCase().trim();
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

  const where: {
    status?: string;
    OR?: Array<{ name?: { contains: string }; slug?: { contains: string } }>;
  } = {};
  if (status && status !== 'all') where.status = status;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { slug: { contains: q } },
    ];
  }

  const rows = await db.extension.findMany({
    where,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  // Resolve developers + install counts in two batched queries.
  const devIds = Array.from(new Set(rows.map((r) => r.developerId)));
  const [devUsers, installCounts, featuredSet] = await Promise.all([
    db.user.findMany({
      where: { id: { in: devIds } },
      select: { id: true, name: true, email: true },
    }),
    db.extensionInstall.groupBy({
      by: ['extensionId'],
      _count: { _all: true },
      where: { extensionId: { in: rows.map((r) => r.id) } },
    }),
    getFeaturedIds(),
  ]);
  const devMap = new Map(devUsers.map((u) => [u.id, u]));
  const installCountMap = new Map(
    installCounts.map((i) => [i.extensionId, i._count._all]),
  );

  const extensions = rows.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    developerId: e.developerId,
    developer: devMap.get(e.developerId) ?? {
      id: e.developerId,
      name: 'Unknown',
      email: '—',
    },
    category: e.category,
    iconUrl: e.iconUrl,
    version: e.version,
    status: e.status,
    permissions: safeJson<string[]>(e.permissions) ?? [],
    pricing: e.pricing,
    price: e.price,
    config: safeJson<Record<string, unknown>>(e.config),
    changelog:
      safeJson<Array<{ version: string; date: string; changes: string }>>(e.changelog) ??
      [],
    installCount: e.installCount,
    activeInstallCount: installCountMap.get(e.id) ?? 0,
    rating: e.rating,
    reviewCount: e.reviewCount,
    featured: featuredSet.has(e.id),
    submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
    reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
    reviewedBy: e.reviewedBy,
    reviewNotes: e.reviewNotes,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, extensions, count: extensions.length });
}
