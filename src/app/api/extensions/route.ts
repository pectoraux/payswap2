import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  safeJson,
  CATEGORY_KEYS,
} from '@/lib/extension-catalog';
import { getFeaturedIds } from '@/lib/extension-featured';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/extensions
 *
 * Unified marketplace list endpoint. Query params:
 *   q          — search name + description
 *   category   — single category filter
 *   sort       — popular | newest | rating | name  (default: popular)
 *   status     — extension status filter (defaults to "published")
 *   merchantId — when provided, the response includes each extension's
 *                install row (status + config) for that merchant. Defaults
 *                to the calling merchant when the caller is a merchant.
 *   featured   — "1" to restrict to featured extensions
 *   popular    — "1" to restrict to popular extensions (installCount >= 500)
 *   installed  — "1" to restrict to extensions the merchant has installed
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const category = url.searchParams.get('category')?.toLowerCase().trim() ?? '';
  const sort = url.searchParams.get('sort') ?? 'popular';
  const statusParam = url.searchParams.get('status')?.toLowerCase().trim();
  const status = statusParam && statusParam !== 'all' ? statusParam : 'published';
  const featuredOnly = url.searchParams.get('featured') === '1';
  const popularOnly = url.searchParams.get('popular') === '1';
  const installedOnly = url.searchParams.get('installed') === '1';

  // Resolve merchantId (explicit query > session merchant).
  const explicitMerchantId = url.searchParams.get('merchantId');
  const sessionMerchantId = await requireMerchantId().catch(() => null);
  const merchantId = explicitMerchantId ?? sessionMerchantId ?? null;

  // Optional session (so admins can list non-published extensions).
  const session = await requireSession().catch(() => null);
  const roles = ((session?.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  // Non-admins can only see published extensions.
  const where: {
    status?: string;
    category?: string;
    OR?: Array<{ name?: { contains: string }; description?: { contains: string } }>;
  } = {};
  if (isAdmin) {
    if (status !== 'all') where.status = status;
  } else {
    where.status = 'published';
  }
  if (category && category !== 'all' && CATEGORY_KEYS.includes(category)) {
    where.category = category;
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
    ];
  }

  const orderBy: Record<string, 'asc' | 'desc'> =
    sort === 'newest'
      ? { publishedAt: 'desc' }
      : sort === 'rating'
        ? { rating: 'desc' }
        : sort === 'name'
          ? { name: 'asc' }
          : { installCount: 'desc' }; // default: popular

  let extensions = await db.extension.findMany({
    where,
    orderBy,
  });

  // Featured set comes from the JSON-file store.
  const featuredSet = await getFeaturedIds();

  // In-memory filters (featured / popular / installed) — applied after the
  // DB query because they depend on either the featured store or the
  // merchant's install set.
  let installs: { extensionId: string; status: string; id: string }[] = [];
  if (merchantId) {
    const rows = await db.extensionInstall.findMany({
      where: { merchantId },
      select: { id: true, extensionId: true, status: true },
    });
    installs = rows;
  }
  const installedIds = new Set(installs.map((i) => i.extensionId));

  if (featuredOnly) {
    extensions = extensions.filter((e) => featuredSet.has(e.id));
  }
  if (popularOnly) {
    extensions = extensions.filter((e) => e.installCount >= 500);
  }
  if (installedOnly) {
    extensions = extensions.filter((e) => installedIds.has(e.id));
  }

  const installMap = new Map(installs.map((i) => [i.extensionId, i]));

  const decorated = extensions.map((e) => ({
    ...e,
    permissions: safeJson<string[]>(e.permissions) ?? [],
    config: safeJson<Record<string, unknown>>(e.config),
    changelog: safeJson<Array<{ version: string; date: string; changes: string }>>(e.changelog) ?? [],
    featured: featuredSet.has(e.id),
    install: installMap.get(e.id)
      ? {
          installId: installMap.get(e.id)!.id,
          status: installMap.get(e.id)!.status,
        }
      : null,
  }));

  return NextResponse.json({
    ok: true,
    extensions: decorated,
    count: decorated.length,
    featuredCount: decorated.filter((e) => e.featured).length,
  });
}
