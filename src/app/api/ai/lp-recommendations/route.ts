import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { callLLM, parseJsonArray, getCached, setCached, bustCache } from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shape returned by the LP recommendations endpoint. Each recommendation is
 * rendered as a row by the `<LpAiRecommendations />` client component.
 */
export interface LpRecommendation {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

const CACHE_KEY_PREFIX = 'ai:recommendations:lp';

const SYSTEM_PROMPT =
  'You are a liquidity optimization AI for PaySwap. Analyze the LP\'s data and provide 2-3 recommendations ' +
  'to optimize their liquidity business. Format as JSON array of ' +
  "{title: string, description: string, impact: 'high'|'medium'|'low'}. " +
  'Respond with ONLY the JSON array — no prose, no markdown fences.';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

function parseJsonMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/ai/lp-recommendations
 *
 * Gathers the LP's stake, collateral, capacity, reputation, recent
 * settlements and earned fees, sends a compact summary to the LLM, and
 * returns 2-3 optimization recommendations.
 *
 * - Cached for 5 minutes per LP.
 * - `?refresh=1` bypasses the cache.
 * - On LLM failure the route returns computed fallback recommendations.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) {
    return NextResponse.json(
      { error: 'LP profile not found' },
      { status: 404 },
    );
  }

  const cacheKey = `${CACHE_KEY_PREFIX}:${lp.id}`;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (refresh) bustCache(cacheKey);

  const cached = getCached<LpRecommendation[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ recommendations: cached, cached: true });
  }

  // ── Gather LP signals in parallel ──────────────────────────────────
  const [openPositions, openAgg, settledAgg, recentSettlements] =
    await Promise.all([
      db.payment.count({
        where: {
          lpId: lp.id,
          status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
        },
      }),
      db.payment.aggregate({
        where: {
          lpId: lp.id,
          status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
        },
        _sum: { amount: true },
      }),
      db.payment.aggregate({
        where: { lpId: lp.id, status: 'COMPLETED' },
        _sum: { amount: true, fee: true },
        _count: { _all: true },
      }),
      db.payment.findMany({
        where: { lpId: lp.id, status: 'COMPLETED' },
        orderBy: { settledAt: 'desc' },
        take: 5,
        select: { amount: true, currency: true, corridor: true, fee: true },
      }),
    ]);

  const capacity = parseJsonMap(lp.capacity);
  const currencies = parseList(lp.currencies);
  const totalCapacity = Object.values(capacity).reduce((s, n) => s + n, 0);
  const availableCapacity = Math.max(0, lp.stake - lp.collateral);
  const utilization =
    lp.stake > 0 ? Math.min(100, Math.round((lp.collateral / lp.stake) * 100)) : 0;
  const openVolume = openAgg._sum.amount ?? 0;
  const settledVolume = settledAgg._sum.amount ?? 0;
  const earnedFees = settledAgg._sum.fee ?? 0;
  const settledCount = settledAgg._count._all ?? 0;

  const summary = {
    lp: { name: lp.name, country: lp.country, tier: lp.tier, status: lp.status },
    capital: {
      stake: lp.stake,
      collateral: lp.collateral,
      available: availableCapacity,
      utilizationPct: utilization,
      totalCapacity,
      capacityByCorridor: capacity,
    },
    reputation: lp.reputation,
    settlementSpeedMs: lp.settlementSpeedMs,
    currencies,
    activity: {
      openPositions,
      openVolume,
      settledCount,
      settledVolume,
      earnedFees,
    },
    recentSettlements,
  };

  // ── Best-effort LLM call ───────────────────────────────────────────
  const userPrompt =
    'LP analytics summary (JSON):\n' +
    JSON.stringify(summary, null, 2) +
    '\n\nGenerate 2-3 recommendations to optimize this LP\'s liquidity business. Return ONLY the JSON array.';
  const llmText = await callLLM(SYSTEM_PROMPT, userPrompt);
  const parsed = parseJsonArray<LpRecommendation>(llmText);

  let recommendations: LpRecommendation[];
  if (parsed && parsed.length > 0) {
    recommendations = sanitizeRecommendations(parsed);
  } else {
    recommendations = computeFallbackRecommendations(summary);
  }

  setCached(cacheKey, recommendations);
  return NextResponse.json({ recommendations, cached: false });
}

/** Normalize LLM output: coerce unknown impacts and trim strings. */
function sanitizeRecommendations(raw: LpRecommendation[]): LpRecommendation[] {
  const allowed: LpRecommendation['impact'][] = ['high', 'medium', 'low'];
  return raw
    .filter((r) => r && typeof r.title === 'string' && typeof r.description === 'string')
    .slice(0, 3)
    .map((r) => ({
      title: r.title.slice(0, 120),
      description: r.description.slice(0, 500),
      impact: allowed.includes(r.impact) ? r.impact : 'medium',
    }));
}

interface LpSummary {
  capital: {
    stake: number;
    collateral: number;
    available: number;
    utilizationPct: number;
    totalCapacity: number;
    capacityByCorridor: Record<string, number>;
  };
  reputation: number;
  settlementSpeedMs: number;
  currencies: string[];
  activity: {
    openPositions: number;
    openVolume: number;
    settledCount: number;
    settledVolume: number;
    earnedFees: number;
  };
}

/** Deterministic fallback recommendations for when the LLM is unavailable. */
function computeFallbackRecommendations(s: LpSummary): LpRecommendation[] {
  const out: LpRecommendation[] = [];
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);

  // Utilization too high → release capital or top up.
  if (s.capital.utilizationPct >= 90) {
    out.push({
      title: 'Capacity nearly fully committed',
      description: `Your collateral utilization is ${s.capital.utilizationPct}% — you're close to your stake ceiling. Deposit more capital or wait for open positions to settle to avoid rejecting routed payments.`,
      impact: 'high',
    });
  } else if (s.capital.utilizationPct < 30 && s.capital.stake > 0) {
    out.push({
      title: 'Idle capital is earning nothing',
      description: `Only ${s.capital.utilizationPct}% of your stake is deployed. ${fmt(s.capital.available)} is sitting idle — consider opening additional corridors or lowering your fee bps to attract more routing volume.`,
      impact: 'medium',
    });
  }

  // Reputation.
  if (s.reputation < 0.7) {
    out.push({
      title: 'Improve your reputation score',
      description: `Your reputation is ${s.reputation.toFixed(2)}/1.00. Faster settlements and fewer failed routes will raise it, unlocking higher-volume corridors and better fee tiers.`,
      impact: 'high',
    });
  } else if (s.reputation >= 0.9) {
    out.push({
      title: 'You qualify for premium corridors',
      description: `With a reputation of ${s.reputation.toFixed(2)}/1.00, you're eligible for high-priority corridors. Review the corridor marketplace for newly opened premium routes.`,
      impact: 'medium',
    });
  }

  // Settlement speed.
  if (s.settlementSpeedMs > 5000) {
    out.push({
      title: 'Tighten your settlement speed',
      description: `Your average settlement time of ${(s.settlementSpeedMs / 1000).toFixed(1)}s is slower than the 2s benchmark. Faster settlement improves routing priority and reputation.`,
      impact: 'medium',
    });
  }

  // Revenue / volume.
  if (s.activity.settledCount === 0) {
    out.push({
      title: 'No settlements yet',
      description:
        'You have no completed settlements. Ensure your corridors are active and your fee bps are competitive so the router selects you for payments.',
      impact: 'high',
    });
  } else if (s.activity.earnedFees > 0 && s.activity.settledVolume > 0) {
    const effectiveBps = (s.activity.earnedFees / s.activity.settledVolume) * 10000;
    out.push({
      title: 'Optimize your fee structure',
      description: `You've earned ${fmt(s.activity.earnedFees)} on ${fmt(s.activity.settledVolume)} settled (~${effectiveBps.toFixed(0)} bps). Test a small fee reduction to capture more routing volume and grow total revenue.`,
      impact: s.capital.utilizationPct < 50 ? 'high' : 'low',
    });
  }

  // Corridor diversification.
  const corridorCount = Object.keys(s.capital.capacityByCorridor).length;
  if (corridorCount > 0 && corridorCount < 3) {
    out.push({
      title: 'Diversify across more corridors',
      description: `You have capacity configured for ${corridorCount} corridor${corridorCount === 1 ? '' : 's'}. Adding capacity to adjacent corridors spreads risk and increases routing opportunities.`,
      impact: 'medium',
    });
  }

  // Always ensure at least one recommendation.
  if (out.length === 0) {
    out.push({
      title: 'Position looks healthy',
      description: `Your stake of ${fmt(s.capital.stake)} is ${s.capital.utilizationPct}% utilized with a reputation of ${s.reputation.toFixed(2)}/1.00. Keep monitoring routing volume to maintain utilization.`,
      impact: 'low',
    });
  }

  return out.slice(0, 3);
}
