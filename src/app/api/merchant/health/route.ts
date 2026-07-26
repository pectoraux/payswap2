import { NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Factor {
  name: string;
  /** Current normalised 0–100 sub-score for this factor. */
  value: number;
  /** Display value (e.g. "97.5%" or "3.2h"). */
  display: string;
  /** Short human hint shown under the factor bar. */
  hint: string;
  max: number;
  status: 'good' | 'warn' | 'bad';
}

/** Map a 0–100 sub-score to a qualitative status band. */
function band(v: number): 'good' | 'warn' | 'bad' {
  if (v >= 80) return 'good';
  if (v >= 60) return 'warn';
  return 'bad';
}

function clamp(v: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * GET /api/merchant/health
 *
 * Computes a 0–100 merchant health score from real database activity.
 * The score is a weighted blend of five factors:
 *
 *   1. Payment success rate  (weight 30)  — completed / total payments
 *   2. Refund rate           (weight 25)  — refunds / total payments (lower is better)
 *   3. Dispute rate          (weight 25)  — pending refunds / total payments (lower is better)
 *   4. Avg settlement time   (weight 10)  — mean(settledAt - createdAt) for completed payments
 *   5. API usage             (weight 10)  — API keys + webhook endpoints configured
 *
 * Returns:
 *   { score, status, factors: Factor[], recommendations: string[] }
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();

  // ── Gather raw signals in parallel ────────────────────────────────
  const [
    paymentTotal,
    paymentCompleted,
    paymentSettledRows,
    refundTotal,
    refundPending,
    apiKeyCount,
    webhookCount,
  ] = await Promise.all([
    db.payment.count({ where: { merchantId, environment: env } }),
    db.payment.count({
      where: {
        merchantId,
        environment: env,
        status: { in: ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'] },
      },
    }),
    db.payment.findMany({
      where: {
        merchantId,
        environment: env,
        settledAt: { not: null },
      },
      select: { createdAt: true, settledAt: true },
      take: 500,
    }),
    db.refund.count({ where: { merchantId, environment: env } }),
    db.refund.count({
      where: { merchantId, environment: env, status: 'PENDING' },
    }),
    db.apiKey.count({ where: { merchantId, environment: env } }),
    db.webhookEndpoint.count({ where: { merchantId, environment: env } }),
  ]);

  // ── Factor 1: payment success rate ────────────────────────────────
  const successRate =
    paymentTotal > 0 ? paymentCompleted / paymentTotal : 1;
  const successScore = clamp(successRate * 100);

  // ── Factor 2: refund rate (lower is better) ───────────────────────
  // A 5% refund rate is acceptable; anything ≥ 20% tanks the score.
  const refundRate = paymentTotal > 0 ? refundTotal / paymentTotal : 0;
  const refundScore = clamp(100 * (1 - Math.min(refundRate, 0.2) / 0.2));

  // ── Factor 3: dispute rate (lower is better) ──────────────────────
  // 2% is acceptable; ≥ 10% is critical.
  const disputeRate = paymentTotal > 0 ? refundPending / paymentTotal : 0;
  const disputeScore = clamp(100 * (1 - Math.min(disputeRate, 0.1) / 0.1));

  // ── Factor 4: average settlement time ─────────────────────────────
  // Target < 1h = perfect; ≥ 48h = 0. No settled payments → neutral 70.
  let settlementScore = 70;
  let settlementHours = 0;
  if (paymentSettledRows.length > 0) {
    const ms = paymentSettledRows.reduce((s, p) => {
      if (!p.settledAt) return s;
      return s + (new Date(p.settledAt).getTime() - new Date(p.createdAt).getTime());
    }, 0) / paymentSettledRows.length;
    settlementHours = ms / 3600000;
    if (settlementHours <= 1) settlementScore = 100;
    else if (settlementHours >= 48) settlementScore = 0;
    else settlementScore = clamp(100 - ((settlementHours - 1) / 47) * 100);
  }

  // ── Factor 5: API usage ───────────────────────────────────────────
  const integrationCount = apiKeyCount + webhookCount;
  const apiScore =
    integrationCount >= 3
      ? 100
      : integrationCount === 2
        ? 80
        : integrationCount === 1
          ? 60
          : 0;

  // ── Weighted overall score ────────────────────────────────────────
  const score = Math.round(
    successScore * 0.3 +
      refundScore * 0.25 +
      disputeScore * 0.25 +
      settlementScore * 0.1 +
      apiScore * 0.1,
  );

  function fmtPct(n: number) {
    return `${(n * 100).toFixed(1)}%`;
  }
  function fmtHours(h: number) {
    if (h <= 0) return '—';
    if (h < 1) return `${(h * 60).toFixed(0)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  }

  const factors: Factor[] = [
    {
      name: 'Payment success rate',
      value: Math.round(successScore),
      display: paymentTotal > 0 ? fmtPct(successRate) : '—',
      hint: `${paymentCompleted} of ${paymentTotal} payments completed`,
      max: 100,
      status: band(successScore),
    },
    {
      name: 'Refund rate',
      value: Math.round(refundScore),
      display: paymentTotal > 0 ? fmtPct(refundRate) : '—',
      hint:
        refundTotal === 0
          ? 'No refunds issued'
          : `${refundTotal} refund${refundTotal === 1 ? '' : 's'} across ${paymentTotal} payments`,
      max: 100,
      status: band(refundScore),
    },
    {
      name: 'Dispute rate',
      value: Math.round(disputeScore),
      display: paymentTotal > 0 ? fmtPct(disputeRate) : '—',
      hint:
        refundPending === 0
          ? 'No open disputes'
          : `${refundPending} open dispute${refundPending === 1 ? '' : 's'}`,
      max: 100,
      status: band(disputeScore),
    },
    {
      name: 'Avg settlement time',
      value: Math.round(settlementScore),
      display: fmtHours(settlementHours),
      hint:
        paymentSettledRows.length === 0
          ? 'No settled payments yet'
          : `across ${paymentSettledRows.length} settled payment${paymentSettledRows.length === 1 ? '' : 's'}`,
      max: 100,
      status: band(settlementScore),
    },
    {
      name: 'API & webhook usage',
      value: Math.round(apiScore),
      display: `${integrationCount} configured`,
      hint: `${apiKeyCount} API key${apiKeyCount === 1 ? '' : 's'} · ${webhookCount} webhook${webhookCount === 1 ? '' : 's'}`,
      max: 100,
      status: band(apiScore),
    },
  ];

  // ── Recommendations ───────────────────────────────────────────────
  const recommendations: string[] = [];
  if (band(refundScore) === 'bad') {
    recommendations.push(
      'Your refund rate is above average. Consider reviewing product descriptions and customer support workflows.',
    );
  } else if (band(refundScore) === 'warn') {
    recommendations.push(
      'Refund rate is creeping up — keep an eye on recent refunds for common causes.',
    );
  }
  if (band(disputeScore) !== 'good') {
    recommendations.push(
      'You have open disputes. Resolve them promptly in the Dispute Center to protect your win rate.',
    );
  }
  if (band(successScore) === 'bad') {
    recommendations.push(
      'Your payment success rate is low. Inspect failed payments and review your routing configuration.',
    );
  } else if (band(successScore) === 'warn') {
    recommendations.push(
      'Some payments are failing. Monitor the payments table for recurring failure reasons.',
    );
  }
  if (band(settlementScore) === 'bad') {
    recommendations.push(
      'Settlement times are higher than ideal. Review your payout schedule and banking connectors.',
    );
  }
  if (band(apiScore) !== 'good') {
    recommendations.push(
      'Set up API keys and webhook endpoints to automate your integration and stay in sync with PaySwap events.',
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'Your merchant account is in excellent health. Keep it up!',
    );
  }

  const status: 'good' | 'warn' | 'bad' = band(score);

  return NextResponse.json({
    score,
    status,
    factors,
    recommendations,
    meta: {
      paymentTotal,
      paymentCompleted,
      refundTotal,
      refundPending,
      apiKeyCount,
      webhookCount,
    },
  });
}
