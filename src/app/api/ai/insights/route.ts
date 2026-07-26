import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import {
  callLLM,
  parseJsonArray,
  getCached,
  setCached,
  bustCache,
  clamp,
} from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shape returned by the merchant insights endpoint. Each insight is rendered
 * as a color-coded row by the `<AiInsights />` client component.
 */
export interface MerchantInsight {
  type: 'positive' | 'warning' | 'opportunity' | 'risk';
  title: string;
  description: string;
  metric?: string;
}

const CACHE_KEY_PREFIX = 'ai:insights:merchant';

const SYSTEM_PROMPT =
  'You are a payment analytics AI for PaySwap. Analyze the merchant\'s data and provide 3-4 actionable insights. ' +
  'Be specific, concise, and data-driven. Format as JSON array of ' +
  "{type: 'positive'|'warning'|'opportunity'|'risk', title: string, description: string, metric?: string}. " +
  'Respond with ONLY the JSON array — no prose, no markdown fences.';

/**
 * GET /api/ai/insights
 *
 * Gathers real merchant activity from the DB (revenue, success rate, refund
 * rate, top customers, top products, 7-day payment trend, health score),
 * sends a compact summary to the LLM, and returns 3-4 actionable insights.
 *
 * - Cached for 5 minutes per merchant+environment.
 * - `?refresh=1` bypasses the cache.
 * - On any LLM failure the route returns computed fallback insights so the
 *   dashboard never shows a blank card.
 */
export async function GET(req: NextRequest) {
  let merchantId: string;
  let merchant: { currency: string; name: string };
  try {
    const result = await requireMerchant();
    merchantId = result.merchantId;
    merchant = result.merchant;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = await getEnvironment();
  const cacheKey = `${CACHE_KEY_PREFIX}:${merchantId}:${env}`;

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (refresh) bustCache(cacheKey);

  const cached = getCached<MerchantInsight[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ insights: cached, cached: true });
  }

  // ── Gather real merchant signals in parallel ──────────────────────
  const now = new Date();
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    paymentTotal,
    paymentCompleted,
    completedAgg,
    refundTotal,
    refundPending,
    topCustomersRaw,
    topProductsRaw,
    recentPaymentsAgg,
    prevPaymentsAgg,
  ] = await Promise.all([
    db.payment.count({ where: { merchantId, environment: env } }),
    db.payment.count({
      where: {
        merchantId,
        environment: env,
        status: { in: ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'] },
      },
    }),
    db.payment.aggregate({
      where: {
        merchantId,
        environment: env,
        status: { in: ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'] },
      },
      _sum: { amount: true },
    }),
    db.refund.count({ where: { merchantId, environment: env } }),
    db.refund.count({
      where: { merchantId, environment: env, status: 'PENDING' },
    }),
    db.customerRecord.findMany({
      where: { merchantId, environment: env },
      orderBy: { totalSpent: 'desc' },
      take: 3,
      select: { name: true, email: true, totalSpent: true, transactionCount: true },
    }),
    db.product.findMany({
      where: { merchantId, environment: env, deletedAt: null },
      orderBy: { price: 'desc' },
      take: 3,
      select: { name: true, price: true, currency: true, status: true },
    }),
    db.payment.aggregate({
      where: {
        merchantId,
        environment: env,
        createdAt: { gte: last7Start },
        status: { in: ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.payment.aggregate({
      where: {
        merchantId,
        environment: env,
        createdAt: { gte: prev7Start, lt: last7Start },
        status: { in: ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const totalRevenue = completedAgg._sum.amount ?? 0;
  const successRate = paymentTotal > 0 ? paymentCompleted / paymentTotal : 1;
  const refundRate = paymentTotal > 0 ? refundTotal / paymentTotal : 0;
  const disputeRate = paymentTotal > 0 ? refundPending / paymentTotal : 0;

  // Lightweight health-score mirror of /api/merchant/health (kept inline so
  // we don't reach into the kernel or duplicate an HTTP round-trip).
  const successScore = clamp(successRate * 100);
  const refundScore = clamp(100 * (1 - Math.min(refundRate, 0.2) / 0.2));
  const disputeScore = clamp(100 * (1 - Math.min(disputeRate, 0.1) / 0.1));
  const healthScore = Math.round(
    successScore * 0.3 + refundScore * 0.25 + disputeScore * 0.25 + 70 * 0.1 + 60 * 0.1,
  );

  const recentRevenue = recentPaymentsAgg._sum.amount ?? 0;
  const recentCount = recentPaymentsAgg._count._all ?? 0;
  const prevRevenue = prevPaymentsAgg._sum.amount ?? 0;
  const prevCount = prevPaymentsAgg._count._all ?? 0;
  const revenueDelta =
    prevRevenue > 0
      ? ((recentRevenue - prevRevenue) / prevRevenue) * 100
      : recentRevenue > 0
        ? 100
        : 0;
  const countDelta =
    prevCount > 0
      ? ((recentCount - prevCount) / prevCount) * 100
      : recentCount > 0
        ? 100
        : 0;

  const currency = merchant.currency || 'USD';

  const summary = {
    merchant: merchant.name,
    currency,
    environment: env,
    totals: {
      revenue: totalRevenue,
      paymentCount: paymentTotal,
      completedPayments: paymentCompleted,
      refunds: refundTotal,
      openDisputes: refundPending,
    },
    rates: {
      successRate: Number((successRate * 100).toFixed(1)),
      refundRate: Number((refundRate * 100).toFixed(1)),
      disputeRate: Number((disputeRate * 100).toFixed(1)),
      healthScore,
    },
    trend: {
      last7Days: { revenue: recentRevenue, count: recentCount },
      previous7Days: { revenue: prevRevenue, count: prevCount },
      revenueChangePct: Number(revenueDelta.toFixed(1)),
      countChangePct: Number(countDelta.toFixed(1)),
    },
    topCustomers: topCustomersRaw.map((c) => ({
      name: c.name,
      email: c.email,
      totalSpent: c.totalSpent,
      transactions: c.transactionCount,
    })),
    topProducts: topProductsRaw.map((p) => ({
      name: p.name,
      price: p.price,
      currency: p.currency,
      status: p.status,
    })),
  };

  // ── Best-effort LLM call ───────────────────────────────────────────
  const userPrompt =
    'Merchant analytics summary (JSON):\n' +
    JSON.stringify(summary, null, 2) +
    '\n\nGenerate 3-4 actionable insights for this merchant. Return ONLY the JSON array.';
  const llmText = await callLLM(SYSTEM_PROMPT, userPrompt);
  const parsed = parseJsonArray<MerchantInsight>(llmText);

  let insights: MerchantInsight[];
  if (parsed && parsed.length > 0) {
    insights = sanitizeInsights(parsed);
  } else {
    insights = computeFallbackInsights(summary);
  }

  setCached(cacheKey, insights);
  return NextResponse.json({ insights, cached: false });
}

/** Normalize LLM output: coerce unknown types and trim strings. */
function sanitizeInsights(raw: MerchantInsight[]): MerchantInsight[] {
  const allowed: MerchantInsight['type'][] = [
    'positive',
    'warning',
    'opportunity',
    'risk',
  ];
  return raw
    .filter((i) => i && typeof i.title === 'string' && typeof i.description === 'string')
    .slice(0, 4)
    .map((i) => ({
      type: allowed.includes(i.type) ? i.type : 'opportunity',
      title: i.title.slice(0, 120),
      description: i.description.slice(0, 500),
      metric:
        typeof i.metric === 'string' && i.metric.trim()
          ? i.metric.slice(0, 40)
          : undefined,
    }));
}

interface MerchantSummary {
  currency: string;
  totals: {
    revenue: number;
    paymentCount: number;
    completedPayments: number;
    refunds: number;
    openDisputes: number;
  };
  rates: {
    successRate: number;
    refundRate: number;
    disputeRate: number;
    healthScore: number;
  };
  trend: {
    revenueChangePct: number;
    countChangePct: number;
    last7Days: { count: number };
  };
  topCustomers: { name: string; totalSpent: number; transactions: number }[];
  topProducts: { name: string; price: number }[];
}

/**
 * Deterministic, data-driven insights used when the LLM is unavailable.
 * These mirror the kind of observations the model would make so the card is
 * still useful during outages.
 */
function computeFallbackInsights(s: MerchantSummary): MerchantInsight[] {
  const out: MerchantInsight[] = [];
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: s.currency,
      maximumFractionDigits: 0,
    }).format(n);

  if (s.totals.paymentCount === 0) {
    out.push({
      type: 'opportunity',
      title: 'Start processing payments',
      description:
        'You have no payments yet. Create a payment link or send an invoice to capture your first sale and unlock AI-driven analytics.',
    });
    return out;
  }

  // Success rate insight.
  if (s.rates.successRate >= 95) {
    out.push({
      type: 'positive',
      title: 'Strong payment success rate',
      description: `Your success rate of ${s.rates.successRate}% is above the 95% industry benchmark — keep monitoring failure reasons to stay there.`,
      metric: `${s.rates.successRate}% success`,
    });
  } else if (s.rates.successRate < 85) {
    out.push({
      type: 'risk',
      title: 'Payment success rate is below benchmark',
      description: `Only ${s.rates.successRate}% of payments complete successfully. Inspect failed payments and review your routing configuration.`,
      metric: `${s.rates.successRate}% success`,
    });
  }

  // Refund rate insight.
  if (s.rates.refundRate >= 10) {
    out.push({
      type: 'warning',
      title: 'Refund rate is elevated',
      description: `Your refund rate of ${s.rates.refundRate}% is above the 5% acceptable threshold. Review recent refunds for common causes.`,
      metric: `${s.rates.refundRate}% refunds`,
    });
  } else if (s.totals.refunds === 0) {
    out.push({
      type: 'positive',
      title: 'No refunds issued',
      description:
        'You have a clean refund record — a strong signal of product-market fit and customer satisfaction.',
    });
  }

  // Open disputes.
  if (s.totals.openDisputes > 0) {
    out.push({
      type: 'risk',
      title: 'Open disputes need attention',
      description: `You have ${s.totals.openDisputes} open dispute${s.totals.openDisputes === 1 ? '' : 's'}. Resolve them promptly in the Dispute Center to protect your win rate.`,
      metric: `${s.totals.openDisputes} open`,
    });
  }

  // Trend insight.
  if (s.trend.revenueChangePct > 0) {
    out.push({
      type: 'positive',
      title: 'Revenue is trending up',
      description: `Revenue grew ${s.trend.revenueChangePct.toFixed(1)}% over the last 7 days vs the previous week. Double down on what's working.`,
      metric: `+${s.trend.revenueChangePct.toFixed(1)}%`,
    });
  } else if (s.trend.revenueChangePct < 0) {
    out.push({
      type: 'warning',
      title: 'Revenue is declining',
      description: `Revenue dropped ${Math.abs(s.trend.revenueChangePct).toFixed(1)}% week-over-week. Investigate recent payment failures or seasonal dips.`,
      metric: `${s.trend.revenueChangePct.toFixed(1)}%`,
    });
  }

  // Top customer concentration.
  if (s.topCustomers.length > 0 && s.totals.revenue > 0) {
    const top = s.topCustomers[0];
    const share = (top.totalSpent / s.totals.revenue) * 100;
    if (share > 30) {
      out.push({
        type: 'opportunity',
        title: 'Customer concentration risk',
        description: `${top.name} accounts for ${share.toFixed(0)}% of your revenue. Diversify your customer base to reduce dependency.`,
        metric: `${share.toFixed(0)}% from top customer`,
      });
    } else {
      out.push({
        type: 'opportunity',
        title: 'Engage your top customers',
        description: `${top.name} is your top spender at ${fmt(top.totalSpent)} across ${top.transactions} transactions. Offer a loyalty perk to boost retention.`,
        metric: fmt(top.totalSpent),
      });
    }
  }

  // Product opportunity.
  if (s.topProducts.length > 0 && s.totals.paymentCount < 10) {
    const p = s.topProducts[0];
    out.push({
      type: 'opportunity',
      title: 'Promote your top product',
      description: `Your highest-value product "${p.name}" is priced at ${fmt(p.price)}. Build a payment link to start selling it quickly.`,
      metric: fmt(p.price),
    });
  }

  // Always ensure at least one insight.
  if (out.length === 0) {
    out.push({
      type: 'positive',
      title: 'Account health looks solid',
      description: `Your health score is ${s.rates.healthScore}/100 with ${s.totals.completedPayments} completed payments. Keep monitoring to maintain momentum.`,
      metric: `${s.rates.healthScore}/100`,
    });
  }

  return out.slice(0, 4);
}
