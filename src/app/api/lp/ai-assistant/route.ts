import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  callLLM,
  parseJsonArray,
  getCached,
  setCached,
  bustCache,
} from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/lp/ai-assistant — LP optimization recommendations
//
// Consolidates the former `/api/ai/lp-recommendations` endpoint into the
// canonical LP AI surface so that all LP AI features (chat + recommendations)
// live behind a single route. Response shape is preserved exactly:
//   { recommendations: LpRecommendation[], cached: boolean }
// ─────────────────────────────────────────────────────────────────────

export interface LpRecommendation {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

const RECO_CACHE_KEY_PREFIX = 'ai:recommendations:lp';

const RECO_SYSTEM_PROMPT =
  'You are a liquidity optimization AI for PaySwap. Analyze the LP\'s data and provide 2-3 recommendations ' +
  'to optimize their liquidity business. Format as JSON array of ' +
  "{title: string, description: string, impact: 'high'|'medium'|'low'}. " +
  'Respond with ONLY the JSON array — no prose, no markdown fences.';

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
 * GET /api/lp/ai-assistant
 *
 * Returns 2-3 LLM-generated optimization recommendations for the
 * authenticated LP. Falls back to computed recommendations on LLM failure.
 * Cached for 5 minutes per LP; `?refresh=1` bypasses the cache.
 *
 * (Formerly `/api/ai/lp-recommendations` — consolidated under the canonical
 * LP AI route by the HARDEN-FIX sprint.)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) {
    return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });
  }

  const cacheKey = `${RECO_CACHE_KEY_PREFIX}:${lp.id}`;
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

  const summary: LpRecoSummary = {
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
  const llmText = await callLLM(RECO_SYSTEM_PROMPT, userPrompt);
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

interface LpRecoSummary {
  lp: { name: string; country: string; tier: string; status: string };
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
  recentSettlements: Array<{
    amount: number;
    currency: string;
    corridor: string | null;
    fee: number;
  }>;
}

/** Deterministic fallback recommendations for when the LLM is unavailable. */
function computeFallbackRecommendations(s: LpRecoSummary): LpRecommendation[] {
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

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/lp/ai-assistant
 *
 * Body: { messages: ChatTurn[] }
 *
 * Returns: { reply: string, contextSnapshot: {...} }
 *
 * This endpoint gives the LP a context-aware chat assistant that knows
 * about LP concepts (corridors, fees, capacity, collateral, reputation,
 * settlements) AND the LP's current state (their stake, capacity map,
 * active corridors, recent settlements, reputation, settlement speed).
 *
 * The LLM is called via the shared `callLLM` helper which wraps
 * `z-ai-web-dev-sdk`. If the LLM call fails we fall back to a deterministic
 * rule-based answer so the assistant never returns an empty reply.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
  }
  // Cap the conversation history at the last 12 turns so the prompt doesn't
  // blow up — most LP questions are short.
  const recentTurns: ChatTurn[] = body.messages
    .slice(-12)
    .filter(
      (m: any) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const lastUser = [...recentTurns].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return NextResponse.json({ error: 'No user message found' }, { status: 400 });
  }

  // ── Gather LP state in parallel ──────────────────────────────────────
  const [openPositions, openAgg, settledAgg, recentSettlements, failedCount] =
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
        select: {
          amount: true,
          currency: true,
          corridor: true,
          fee: true,
          settledAt: true,
        },
      }),
      db.payment.count({
        where: {
          lpId: lp.id,
          status: { in: ['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'DECLINED'] },
        },
      }),
    ]);

  const capacity = parseJsonMap(lp.capacity);
  const feeBps = parseJsonMap(lp.feeBps);
  const currencies = parseList(lp.currencies);
  const totalCapacity = Object.values(capacity).reduce((s, n) => s + n, 0);
  const available = Math.max(0, lp.stake - lp.collateral);
  const utilization =
    lp.stake > 0 ? Math.min(100, Math.round((lp.collateral / lp.stake) * 100)) : 0;
  const openVolume = openAgg._sum.amount ?? 0;
  const settledVolume = settledAgg._sum.amount ?? 0;
  const earnedFees = settledAgg._sum.fee ?? 0;
  const settledCount = settledAgg._count._all ?? 0;

  // Per-corridor detail (used to answer "how much fee should I charge for GHS→NGN?").
  const corridors = Object.keys(capacity).map((c) => ({
    corridor: c,
    capacity: capacity[c],
    feeBps: feeBps[c] ?? null,
  }));

  const contextSnapshot = {
    lp: {
      name: lp.name,
      country: lp.country,
      tier: lp.tier,
      status: lp.status,
      reputation: lp.reputation,
      settlementSpeedMs: lp.settlementSpeedMs,
    },
    capital: {
      stake: lp.stake,
      collateral: lp.collateral,
      available,
      utilizationPct: utilization,
      totalCapacity,
    },
    currencies,
    corridors,
    activity: {
      openPositions,
      openVolume,
      settledCount,
      settledVolume,
      earnedFees,
      failedCount,
    },
    recentSettlements: recentSettlements.map((s) => ({
      corridor: s.corridor,
      amount: s.amount,
      currency: s.currency,
      fee: s.fee,
      settledAt: s.settledAt,
    })),
  };

  const systemPrompt = `You are the PaySwap LP Assistant — a friendly, expert AI that helps Liquidity Providers run their liquidity business on PaySwap.

You are talking directly to the LP named "${lp.name}" (tier: ${lp.tier}, country: ${lp.country}). You can see their live account state and should use it to give specific, actionable answers — never generic advice.

Your knowledge covers:
- **Stake & collateral**: stake is the LP's total committed capital; collateral is the portion currently locked against open positions; available = stake − collateral (this is what they can withdraw or use for new corridors).
- **Capacity**: per-corridor caps on how much notional they'll settle at once. Draws from stake.
- **Fee (bps)**: per-corridor fee in basis points. 100 bps = 1%. Higher fees = more revenue per settlement but lower routing priority (router prefers cheaper LPs when multiple are eligible).
- **Corridors**: currency pairs (e.g. GHS→NGN) the LP supports. Source currency = payer's currency; destination currency = payee's currency.
- **Reputation**: 0.00–1.00 score computed from settlement outcomes. Higher reputation = better routing priority + access to premium corridors.
- **Settlement speed**: target latency in ms. Lower = better routing priority.
- **Add Capital**: requires payment method (bank/card/mobile money) + source of funds (compliance).
- **Adjust Reserve**: requires reason (rebalancing, withdrawal, additional_deposit, risk_reduction, other) + payment method for directional reasons + confirmation step showing before/after/delta.
- **Audit log**: every capital movement, corridor change, and settings update is recorded with the LP's user ID, timestamp, and structured reason.

Guidelines:
- Be concise — 2–4 short paragraphs max. Use plain English; avoid jargon unless the LP uses it first.
- When the LP asks a "what should I charge?" question, give a concrete number (e.g. "50 bps") and explain why.
- Reference the LP's actual numbers from the context snapshot when relevant.
- If you don't know something (e.g. future FX rates), say so — never make up numbers.
- If the LP asks something out of scope (engineering, account recovery), point them to support@payswap.io.

Live LP context (JSON):
${JSON.stringify(contextSnapshot, null, 2)}`;

  // Build the message list: system + recent turns. The last turn is the
  // current user question.
  const llmText = await callLLM(systemPrompt, buildUserPrompt(recentTurns));

  let reply: string;
  if (llmText && llmText.length > 0) {
    reply = llmText;
  } else {
    reply = computeFallbackReply(lastUser.content, contextSnapshot);
  }

  return NextResponse.json({
    reply,
    contextSnapshot,
    llmUsed: !!llmText,
  });
}

/** Concatenate the recent turns into a single user prompt for the LLM. */
function buildUserPrompt(turns: ChatTurn[]): string {
  if (turns.length === 1) {
    return turns[0].content;
  }
  // Multi-turn: format as a transcript so the model has context.
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'LP' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  return `Conversation so far:\n${transcript}\n\nContinue the conversation. Reply as the Assistant.`;
}

/**
 * Deterministic fallback reply used when the LLM is unavailable. Pattern-matches
 * common LP questions and answers them from the live context snapshot.
 */
function computeFallbackReply(question: string, ctx: any): string {
  const q = question.toLowerCase();
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);

  // Source vs destination currency
  if (q.includes('source') && q.includes('destination')) {
    return (
      '**Source currency** is the currency the payer sends (e.g. GHS for a Ghanaian customer). ' +
      '**Destination currency** is what the merchant receives (e.g. NGN for a Nigerian merchant). ' +
      'As an LP, your corridor list defines which source→destination pairs you support — ' +
      'e.g. a GHS→NGN corridor means you receive GHS and deliver NGN, pocketing the FX spread + your fee.'
    );
  }

  // Fee recommendation
  if (q.includes('fee') && (q.includes('charge') || q.includes('should') || q.includes('recommend'))) {
    // Look for a corridor code in the question (e.g. "GHS→NGN" or "GHS NGN").
    const corridorMatch = q.match(/([a-z]{3})\s*(?:→|->|to|>|-|\/)\s*([a-z]{3})/);
    if (corridorMatch) {
      const corridor = `${corridorMatch[1].toUpperCase()}→${corridorMatch[2].toUpperCase()}`;
      const current = ctx.corridors.find((c: any) => c.corridor === corridor);
      if (current) {
        const recommended = current.feeBps && current.feeBps > 60 ? current.feeBps - 10 : 50;
        return (
          `For ${corridor} you're currently charging ${current.feeBps ?? '—'} bps. ` +
          `A competitive starting point is ${recommended} bps (${(recommended / 100).toFixed(2)}%). ` +
          `Lower fees = more routing volume; higher fees = more revenue per settlement. ` +
          `Test ${recommended} bps for a week, watch your utilization, and adjust in 5–10 bps increments.`
        );
      }
      return (
        `You don't have a corridor set up for ${corridor} yet. Add it on the Corridors page first, ` +
        `then start at 50 bps (0.50%) — a competitive starting point for most African corridors.`
      );
    }
    return (
      'For most corridors, 50 bps (0.50%) is a competitive starting point. ' +
      'Lower it (20–30 bps) if you have idle capacity and want more routing volume; ' +
      'raise it (75–100 bps) if your utilization is consistently above 80% and you want more revenue per settlement. ' +
      'Adjust in 5–10 bps increments and watch the effect over a week.'
    );
  }

  // Capacity too high?
  if (q.includes('capacity') && (q.includes('too high') || q.includes('high') || q.includes('overcommit'))) {
    return (
      `If you set capacity too high relative to your stake, two things happen: ` +
      `(1) the router will keep routing payments to you until your open positions approach your stake ceiling, ` +
      `which means you can't withdraw capital until they settle; ` +
      `(2) if a corridor goes bad (failed settlements), your downside is larger. ` +
      `Currently your stake is ${fmt(ctx.capital.stake)} with ${ctx.corridors.length} corridor(s) allocating ${fmt(ctx.capital.totalCapacity)} total — ` +
      `that's a ${ctx.capital.totalCapacity > ctx.capital.stake ? 'OVER-ALLOCATED' : 'healthy'} ratio. ` +
      `Rule of thumb: keep total allocated capacity ≤ 80% of your stake so you always have a buffer.`
    );
  }

  // Withdraw earnings
  if (q.includes('withdraw') || q.includes('earnings') || q.includes('cash out')) {
    return (
      `To withdraw your LP earnings: go to **Positions → Capital management → Withdraw tab**. ` +
      `Pick a payment method (bank transfer, card, or mobile money) for delivery, select a reason ` +
      `(e.g. 'withdrawal' or 'risk_reduction'), and enter the amount. ` +
      `Your current available balance is ${fmt(ctx.capital.available)} — ` +
      `that's the portion of your stake (${fmt(ctx.capital.stake)}) not currently locked as collateral against open positions. ` +
      `Withdrawals are audit-logged with the payment-method details.`
    );
  }

  // Default
  return (
    `I can help with that. Your LP account currently has ${fmt(ctx.capital.stake)} staked ` +
    `(${ctx.capital.utilizationPct}% utilized, ${fmt(ctx.capital.available)} available), ` +
    `${ctx.corridors.length} active corridor(s), and a reputation of ${ctx.lp.reputation.toFixed(2)}/1.00. ` +
    `Ask me about fees, capacity, corridors, withdrawals, or how to optimize your liquidity position.`
  );
}
