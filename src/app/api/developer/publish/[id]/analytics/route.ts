import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { parseMarketplaceMeta } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/publish/[id]/analytics
 *
 * Plugin analytics for the developer:
 *   - installCount, rating, reviewCount
 *   - installs over time (last 30 days, derived from ExtensionInstall.installedAt)
 *   - active installs (status = 'enabled')
 *   - review breakdown (1-5 stars)
 *
 * Revenue is estimated from the pricing plan × install count (illustrative
 * only — no real billing integration).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = parseMarketplaceMeta(row.config);

    const [installs, reviews, reviewAgg] = await Promise.all([
      db.extensionInstall.findMany({
        where: { extensionId: id },
        orderBy: { installedAt: 'asc' },
        select: { id: true, status: true, installedAt: true },
      }),
      db.extensionReview.findMany({
        where: { extensionId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, rating: true, comment: true, createdAt: true },
      }),
      db.extensionReview.groupBy({
        by: ['rating'],
        _count: { _all: true },
        where: { extensionId: id },
      }),
    ]);

    // Daily installs (last 30 days).
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const installsByDay: Array<{ date: string; count: number }> = [];
    const dayMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, 0);
    }
    for (const inst of installs) {
      if (inst.installedAt >= thirtyDaysAgo) {
        const key = inst.installedAt.toISOString().slice(0, 10);
        if (dayMap.has(key)) {
          dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
        }
      }
    }
    for (const [date, count] of dayMap.entries()) {
      installsByDay.push({ date, count });
    }

    // Active installs (status = 'enabled' or 'active').
    const activeInstalls = installs.filter(
      (i) => i.status === 'enabled' || i.status === 'active',
    ).length;

    // Estimated revenue.
    const pricing = meta.pricing ?? { model: 'free' as const, summary: 'Free' };
    let estimatedRevenue = 0;
    if (pricing.model === 'one-time' && typeof pricing.price === 'number') {
      estimatedRevenue = installs.length * pricing.price;
    } else if (pricing.model === 'subscription' && typeof pricing.price === 'number') {
      // Monthly subscription × active installs (assume 1 month average so far).
      estimatedRevenue = activeInstalls * pricing.price;
    } else if (pricing.model === 'usage-based' && typeof pricing.pricePerKCalls === 'number') {
      // Assume 5k calls/install/month × 1 month.
      estimatedRevenue = Math.round((installs.length * 5 * pricing.pricePerKCalls) / 10) * 10;
    }

    // Review breakdown (1-5 stars).
    const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviewAgg) {
      breakdown[r.rating] = r._count._all;
    }

    // Rating trend (last 30 days, weekly buckets).
    const ratingTrend: Array<{ week: string; avg: number }> = [];
    const weeklyBuckets: Array<{ start: number; end: number; ratings: number[]; label: string }> = [];
    for (let w = 3; w >= 0; w--) {
      const end = new Date(now.getTime() - w * 7 * 86_400_000);
      const start = new Date(end.getTime() - 7 * 86_400_000);
      weeklyBuckets.push({
        start: start.getTime(),
        end: end.getTime(),
        ratings: [],
        label: `W-${w}`,
      });
    }
    for (const r of reviews) {
      const t = r.createdAt.getTime();
      for (const b of weeklyBuckets) {
        if (t >= b.start && t < b.end) {
          b.ratings.push(r.rating);
          break;
        }
      }
    }
    for (const b of weeklyBuckets) {
      const avg = b.ratings.length > 0 ? b.ratings.reduce((s, r) => s + r, 0) / b.ratings.length : 0;
      ratingTrend.push({ week: b.label, avg: Math.round(avg * 10) / 10 });
    }

    return NextResponse.json({
      ok: true,
      analytics: {
        pluginId: id,
        pluginName: row.name,
        installCount: row.installCount,
        activeInstalls,
        rating: row.rating,
        reviewCount: row.reviewCount,
        estimatedRevenue,
        currency: 'USD',
        installsByDay,
        ratingTrend,
        reviewBreakdown: [
          { stars: 5, count: breakdown[5] },
          { stars: 4, count: breakdown[4] },
          { stars: 3, count: breakdown[3] },
          { stars: 2, count: breakdown[2] },
          { stars: 1, count: breakdown[1] },
        ],
      },
    });
  } catch (err) {
    console.error('[api/developer/publish/[id]/analytics GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
