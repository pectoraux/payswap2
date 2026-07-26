import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { callLLM, parseJsonArray, getCached, setCached, bustCache } from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shape returned by the treasury risk endpoint. Each assessment is rendered
 * as a row by the `<TreasuryAiRiskAssessment />` client component.
 */
export interface TreasuryAssessment {
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  recommendation: string;
}

const CACHE_KEY = 'ai:treasury:assessment';

const SYSTEM_PROMPT =
  'You are a treasury risk AI for PaySwap. Analyze the reserve data and provide 2-3 risk assessments. ' +
  'Format as JSON array of ' +
  "{severity: 'low'|'medium'|'high', title: string, description: string, recommendation: string}. " +
  'Respond with ONLY the JSON array — no prose, no markdown fences.';

function hasTreasuryRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['TREASURY', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

/**
 * GET /api/ai/treasury
 *
 * Gathers platform-wide treasury signals (total reserves, settled volume,
 * backing ratio, AML alerts, failed payouts, failed webhooks), sends a
 * compact summary to the LLM, and returns 2-3 risk assessments.
 *
 * - Cached for 5 minutes (treasury data is platform-wide, so the cache is
 *   shared across all treasury users).
 * - `?refresh=1` bypasses the cache.
 * - On LLM failure the route returns computed fallback assessments.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasTreasuryRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (refresh) bustCache(CACHE_KEY);

  const cached = getCached<TreasuryAssessment[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ assessments: cached, cached: true });
  }

  // ── Gather treasury signals in parallel ────────────────────────────
  const [
    walletAgg,
    paymentsAgg,
    openAlerts,
    failedPayouts,
    failedWebhooks,
    pendingPayoutsAgg,
    openAlertsBySeverity,
  ] = await Promise.all([
    db.wallet.groupBy({
      by: ['currency'],
      _sum: { balance: true, lockedBalance: true, pendingBalance: true },
    }),
    db.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.aMLAlert.count({ where: { status: 'OPEN' } }),
    db.payout.count({ where: { status: 'FAILED' } }),
    db.webhookDelivery.count({ where: { status: 'FAILED' } }),
    db.payout.aggregate({
      where: { status: 'REQUESTED' },
      _sum: { sourceAmount: true },
      _count: { _all: true },
    }),
    db.aMLAlert.groupBy({
      by: ['severity'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    }),
  ]);

  const totalReserves = walletAgg.reduce(
    (s, w) => s + (w._sum.balance ?? 0),
    0,
  );
  const totalLocked = walletAgg.reduce(
    (s, w) => s + (w._sum.lockedBalance ?? 0),
    0,
  );
  const totalPending = walletAgg.reduce(
    (s, w) => s + (w._sum.pendingBalance ?? 0),
    0,
  );
  const totalPaymentsVolume = paymentsAgg._sum.amount ?? 0;
  const totalPaymentsCount = paymentsAgg._count._all ?? 0;
  const backingRatio =
    totalPaymentsVolume > 0 ? totalReserves / totalPaymentsVolume : 0;
  const lockedRatio = totalReserves > 0 ? totalLocked / totalReserves : 0;

  const pendingPayoutsCount = pendingPayoutsAgg._count._all ?? 0;
  const pendingPayoutsVolume = pendingPayoutsAgg._sum.sourceAmount ?? 0;

  const severityBreakdown = openAlertsBySeverity.reduce<Record<string, number>>(
    (acc, b) => {
      acc[b.severity] = b._count._all;
      return acc;
    },
    {},
  );

  const summary = {
    reserves: {
      total: totalReserves,
      locked: totalLocked,
      pending: totalPending,
      currencyCount: walletAgg.length,
      lockedRatio: Number(lockedRatio.toFixed(3)),
    },
    volume: {
      settled: totalPaymentsVolume,
      completedPayments: totalPaymentsCount,
    },
    backing: {
      ratio: Number(backingRatio.toFixed(3)),
      healthy: backingRatio >= 1.2,
      degraded: backingRatio >= 1.0 && backingRatio < 1.2,
      critical: backingRatio < 1.0,
    },
    payouts: {
      pendingCount: pendingPayoutsCount,
      pendingVolume: pendingPayoutsVolume,
      failedCount: failedPayouts,
    },
    alerts: {
      openAML: openAlerts,
      bySeverity: severityBreakdown,
      failedWebhooks,
    },
    perCurrency: walletAgg.map((w) => ({
      currency: w.currency,
      balance: w._sum.balance ?? 0,
      locked: w._sum.lockedBalance ?? 0,
      pending: w._sum.pendingBalance ?? 0,
    })),
  };

  // ── Best-effort LLM call ───────────────────────────────────────────
  const userPrompt =
    'Treasury risk summary (JSON):\n' +
    JSON.stringify(summary, null, 2) +
    '\n\nGenerate 2-3 risk assessments for the treasury team. Return ONLY the JSON array.';
  const llmText = await callLLM(SYSTEM_PROMPT, userPrompt);
  const parsed = parseJsonArray<TreasuryAssessment>(llmText);

  let assessments: TreasuryAssessment[];
  if (parsed && parsed.length > 0) {
    assessments = sanitizeAssessments(parsed);
  } else {
    assessments = computeFallbackAssessments(summary);
  }

  setCached(CACHE_KEY, assessments);
  return NextResponse.json({ assessments, cached: false });
}

/** Normalize LLM output: coerce unknown severities and trim strings. */
function sanitizeAssessments(raw: TreasuryAssessment[]): TreasuryAssessment[] {
  const allowed: TreasuryAssessment['severity'][] = ['low', 'medium', 'high'];
  return raw
    .filter(
      (a) =>
        a &&
        typeof a.title === 'string' &&
        typeof a.description === 'string' &&
        typeof a.recommendation === 'string',
    )
    .slice(0, 3)
    .map((a) => ({
      severity: allowed.includes(a.severity) ? a.severity : 'medium',
      title: a.title.slice(0, 120),
      description: a.description.slice(0, 500),
      recommendation: a.recommendation.slice(0, 500),
    }));
}

interface TreasurySummary {
  reserves: {
    total: number;
    locked: number;
    pending: number;
    currencyCount: number;
    lockedRatio: number;
  };
  volume: { settled: number; completedPayments: number };
  backing: { ratio: number; healthy: boolean; degraded: boolean; critical: boolean };
  payouts: {
    pendingCount: number;
    pendingVolume: number;
    failedCount: number;
  };
  alerts: {
    openAML: number;
    bySeverity: Record<string, number>;
    failedWebhooks: number;
  };
}

/** Deterministic fallback assessments for when the LLM is unavailable. */
function computeFallbackAssessments(s: TreasurySummary): TreasuryAssessment[] {
  const out: TreasuryAssessment[] = [];
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);

  // Backing ratio.
  if (s.backing.critical) {
    out.push({
      severity: 'high',
      title: 'Reserves below backing requirement',
      description: `Backing ratio is ${s.backing.ratio.toFixed(2)}× — below the 1.0× minimum. Reserves of ${fmt(s.reserves.total)} do not fully cover ${fmt(s.volume.settled)} in settled volume.`,
      recommendation:
        'Trigger an auto-rebalance immediately and pause large payouts until reserves are replenished.',
    });
  } else if (s.backing.degraded) {
    out.push({
      severity: 'medium',
      title: 'Backing ratio in the warning band',
      description: `Backing ratio is ${s.backing.ratio.toFixed(2)}× — between 1.0× and 1.2×. Monitor closely as volume grows.`,
      recommendation:
        'Pre-stage a rebalance and review the settlement schedule to keep reserves above 1.2×.',
    });
  } else {
    out.push({
      severity: 'low',
      title: 'Reserves well capitalised',
      description: `Backing ratio is ${s.backing.ratio.toFixed(2)}× with ${fmt(s.reserves.total)} in reserves across ${s.reserves.currencyCount} currencies.`,
      recommendation:
        'No action needed. Continue routine monitoring and rebalance when excess reserves exceed operational needs.',
    });
  }

  // Locked ratio.
  if (s.reserves.lockedRatio > 0.6) {
    out.push({
      severity: s.reserves.lockedRatio > 0.8 ? 'high' : 'medium',
      title: 'High proportion of reserves locked',
      description: `${(s.reserves.lockedRatio * 100).toFixed(0)}% of total reserves (${fmt(s.reserves.locked)}) is locked as collateral, leaving limited headroom for new settlements.`,
      recommendation:
        'Review open positions and release collateral from settled payments to free up available reserves.',
    });
  }

  // AML alerts.
  const criticalAlerts = (s.alerts.bySeverity['CRITICAL'] ?? 0) + (s.alerts.bySeverity['HIGH'] ?? 0);
  if (criticalAlerts > 0) {
    out.push({
      severity: 'high',
      title: 'Critical AML alerts require attention',
      description: `${criticalAlerts} critical/high-severity AML alert${criticalAlerts === 1 ? '' : 's'} are open out of ${s.alerts.openAML} total. These can cascade into freezes if unresolved.`,
      recommendation:
        'Coordinate with the compliance team to triage critical alerts before they trigger automatic corridor freezes.',
    });
  } else if (s.alerts.openAML > 0) {
    out.push({
      severity: 'low',
      title: 'AML alerts open but non-critical',
      description: `${s.alerts.openAML} AML alert${s.alerts.openAML === 1 ? '' : 's'} are open, none at critical or high severity.`,
      recommendation:
        'Continue routine monitoring. No treasury action required unless severity escalates.',
    });
  }

  // Failed payouts.
  if (s.payouts.failedCount > 0) {
    out.push({
      severity: s.payouts.failedCount > 5 ? 'high' : 'medium',
      title: 'Failed payouts need reconciliation',
      description: `${s.payouts.failedCount} payout${s.payouts.failedCount === 1 ? '' : 's'} have failed. With ${fmt(s.payouts.pendingVolume)} pending across ${s.payouts.pendingCount} request${s.payouts.pendingCount === 1 ? '' : 's'}, failed payouts may indicate a connector issue.`,
      recommendation:
        'Inspect the payout connector health and retry failed payouts after the root cause is resolved.',
    });
  }

  // Failed webhooks.
  if (s.alerts.failedWebhooks > 10) {
    out.push({
      severity: 'low',
      title: 'Webhook delivery backlog',
      description: `${s.alerts.failedWebhooks} webhook deliveries have failed, which can delay merchant reconciliation.`,
      recommendation:
        'Replay failed webhook deliveries from the SRE console once endpoints are healthy.',
    });
  }

  return out.slice(0, 3);
}
