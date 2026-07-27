import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set([
  'payments',
  'analytics',
  'compliance',
  'accounting',
  'crm',
  'marketing',
  'shipping',
  'other',
]);

/**
 * Best-effort JSON parse. Returns null when the input is null / malformed.
 */
function safeJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * GET /api/extensions/list
 *
 * Public list of published extensions, with optional filters:
 *   ?category=payments  — filter by category
 *   ?q=quickbooks       — search name + description
 *   ?sort=popular|newest|rating|name
 *
 * Returns extensions with parsed permissions/config/changelog JSON fields.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const sort = url.searchParams.get('sort') ?? 'popular';

  const where: {
    status: string;
    category?: string;
    OR?: Array<{ name?: { contains: string }; description?: { contains: string } }>;
  } = { status: 'published' };

  if (category && VALID_CATEGORIES.has(category.toLowerCase())) {
    where.category = category.toLowerCase();
  }

  if (q) {
    // SQLite is case-insensitive by default for ASCII text in `contains`.
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

  const extensions = await db.extension.findMany({
    where,
    orderBy,
  });

  const decorated = extensions.map((e) => ({
    ...e,
    permissions: safeJson<string[]>(e.permissions) ?? [],
    config: safeJson(e.config),
    changelog: safeJson(e.changelog) ?? [],
  }));

  return NextResponse.json({
    extensions: decorated,
    count: decorated.length,
  });
}
