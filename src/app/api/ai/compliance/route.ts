import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { callLLM, parseJsonArray, getCached, setCached, bustCache } from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shape returned by the compliance prioritization endpoint. Each
 * recommendation is rendered as a row by the `<ComplianceAiPrioritization />`
 * client component.
 */
export interface ComplianceRecommendation {
  priority: 'urgent' | 'high' | 'normal';
  title: string;
  description: string;
}

const CACHE_KEY = 'ai:compliance:prioritization';

const SYSTEM_PROMPT =
  'You are a compliance AI for PaySwap. Analyze the compliance queue and provide 2-3 prioritization recommendations. ' +
  'Format as JSON array of ' +
  "{priority: 'urgent'|'high'|'normal', title: string, description: string}. " +
  'Respond with ONLY the JSON array — no prose, no markdown fences.';

function hasComplianceRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

/**
 * GET /api/ai/compliance
 *
 * Gathers the live compliance queue (open AML alerts by severity, pending
 * KYC reviews, open SAR cases, recent alert activity), sends a compact
 * summary to the LLM, and returns 2-3 prioritization recommendations.
 *
 * - Cached for 5 minutes (compliance queue is platform-wide).
 * - `?refresh=1` bypasses the cache.
 * - On LLM failure the route returns computed fallback recommendations.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasComplianceRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (refresh) bustCache(CACHE_KEY);

  const cached = getCached<ComplianceRecommendation[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ recommendations: cached, cached: true });
  }

  // ── Gather compliance signals in parallel ──────────────────────────
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    openAlerts,
    alertsBySeverity,
    pendingKyc,
    pendingKycByType,
    openSars,
    sarByStatus,
    sanctionsHits,
    recentAlerts,
    recentAlertsAgg,
    oldestOpenAlert,
    closedAlerts,
  ] = await Promise.all([
    db.aMLAlert.count({ where: { status: 'OPEN' } }),
    db.aMLAlert.groupBy({
      by: ['severity'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    }),
    db.complianceReview.count({
      where: { status: 'PENDING', type: 'KYC' },
    }),
    db.complianceReview.groupBy({
      by: ['type'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    }),
    db.sAR.count({ where: { status: { in: ['DRAFT', 'FILED'] } } }),
    db.sAR.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    db.aMLAlert.count({
      where: { alertType: { contains: 'SANCTION', mode: 'insensitive' } },
    }),
    db.aMLAlert.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: {
        severity: true,
        alertType: true,
        entityType: true,
        score: true,
        createdAt: true,
      },
    }),
    db.aMLAlert.count({
      where: { status: 'OPEN', createdAt: { gte: dayAgo } },
    }),
    db.aMLAlert.findFirst({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: { severity: true, alertType: true, createdAt: true },
    }),
    db.aMLAlert.count({ where: { status: 'CLOSED', createdAt: { gte: weekAgo } } }),
  ]);

  const severityMap = alertsBySeverity.reduce<Record<string, number>>((acc, b) => {
    acc[b.severity] = b._count._all;
    return acc;
  }, {});
  const kycByTypeMap = pendingKycByType.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = b._count._all;
    return acc;
  }, {});
  const sarByStatusMap = sarByStatus.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = b._count._all;
    return acc;
  }, {});

  const criticalCount =
    (severityMap['CRITICAL'] ?? 0) + (severityMap['HIGH'] ?? 0);
  const mediumCount = severityMap['MEDIUM'] ?? 0;
  const lowCount = severityMap['LOW'] ?? 0;

  const oldestAgeHours = oldestOpenAlert
    ? (now.getTime() - new Date(oldestOpenAlert.createdAt).getTime()) / 3_600_000
    : 0;

  const summary = {
    alerts: {
      open: openAlerts,
      bySeverity: severityMap,
      critical: criticalCount,
      medium: mediumCount,
      low: lowCount,
      newLast24h: recentAlertsAgg,
    },
    kyc: {
      pending: pendingKyc,
      byType: kycByTypeMap,
    },
    sars: {
      open: openSars,
      byStatus: sarByStatusMap,
    },
    sanctionsHits,
    oldestOpenAlert: oldestOpenAlert
      ? {
          severity: oldestOpenAlert.severity,
          alertType: oldestOpenAlert.alertType,
          ageHours: Number(oldestAgeHours.toFixed(1)),
        }
      : null,
    closedLast7d: closedAlerts,
    recentOpenAlerts: recentAlerts,
  };

  // ── Best-effort LLM call ───────────────────────────────────────────
  const userPrompt =
    'Compliance queue summary (JSON):\n' +
    JSON.stringify(summary, null, 2) +
    '\n\nGenerate 2-3 prioritization recommendations for the compliance team. Return ONLY the JSON array.';
  const llmText = await callLLM(SYSTEM_PROMPT, userPrompt);
  const parsed = parseJsonArray<ComplianceRecommendation>(llmText);

  let recommendations: ComplianceRecommendation[];
  if (parsed && parsed.length > 0) {
    recommendations = sanitizeRecommendations(parsed);
  } else {
    recommendations = computeFallbackRecommendations(summary);
  }

  setCached(CACHE_KEY, recommendations);
  return NextResponse.json({ recommendations, cached: false });
}

/** Normalize LLM output: coerce unknown priorities and trim strings. */
function sanitizeRecommendations(
  raw: ComplianceRecommendation[],
): ComplianceRecommendation[] {
  const allowed: ComplianceRecommendation['priority'][] = [
    'urgent',
    'high',
    'normal',
  ];
  return raw
    .filter((r) => r && typeof r.title === 'string' && typeof r.description === 'string')
    .slice(0, 3)
    .map((r) => ({
      priority: allowed.includes(r.priority) ? r.priority : 'normal',
      title: r.title.slice(0, 120),
      description: r.description.slice(0, 500),
    }));
}

interface ComplianceSummary {
  alerts: {
    open: number;
    bySeverity: Record<string, number>;
    critical: number;
    medium: number;
    low: number;
    newLast24h: number;
  };
  kyc: { pending: number; byType: Record<string, number> };
  sars: { open: number; byStatus: Record<string, number> };
  sanctionsHits: number;
  oldestOpenAlert: { severity: string; alertType: string; ageHours: number } | null;
  closedLast7d: number;
}

/** Deterministic fallback recommendations for when the LLM is unavailable. */
function computeFallbackRecommendations(
  s: ComplianceSummary,
): ComplianceRecommendation[] {
  const out: ComplianceRecommendation[] = [];

  // Critical / high alerts always come first.
  if (s.alerts.critical > 0) {
    out.push({
      priority: 'urgent',
      title: 'Triage critical & high-severity alerts first',
      description: `${s.alerts.critical} critical/high-severity alert${s.alerts.critical === 1 ? '' : 's'} are open. These carry the highest regulatory risk and should be reviewed before anything else.`,
    });
  }

  // Aging alert.
  if (s.oldestOpenAlert && s.oldestOpenAlert.ageHours > 48) {
    out.push({
      priority: s.oldestOpenAlert.severity === 'CRITICAL' ? 'urgent' : 'high',
      title: 'An open alert is aging past the 48h SLA',
      description: `The oldest open alert (${s.oldestOpenAlert.severity} / ${s.oldestOpenAlert.alertType}) has been open for ${s.oldestOpenAlert.ageHours.toFixed(0)}h. SLA breaches attract regulator scrutiny.`,
    });
  }

  // KYC backlog.
  if (s.kyc.pending > 10) {
    out.push({
      priority: 'high',
      title: 'KYC review backlog is growing',
      description: `${s.kyc.pending} KYC reviews are pending. A large queue blocks onboarding and creates customer friction — batch-process the oldest submissions first.`,
    });
  } else if (s.kyc.pending > 0) {
    out.push({
      priority: 'normal',
      title: 'Clear the pending KYC queue',
      description: `${s.kyc.pending} KYC review${s.kyc.pending === 1 ? '' : 's'} pending. Resolve them in arrival order to keep onboarding smooth.`,
    });
  }

  // SAR filing.
  const draftSars = s.sars.byStatus['DRAFT'] ?? 0;
  if (draftSars > 0) {
    out.push({
      priority: 'high',
      title: 'Finalize draft SARs before the filing deadline',
      description: `${draftSars} SAR${draftSars === 1 ? '' : 's'} are in DRAFT status. SARs must be filed within regulatory deadlines — complete the narratives and file them.`,
    });
  }

  // Sanctions hits.
  if (s.sanctionsHits > 0) {
    out.push({
      priority: 'urgent',
      title: 'Sanctions screening hits require verification',
      description: `${s.sanctionsHits} sanctions hit${s.sanctionsHits === 1 ? '' : 's'} have been flagged. Confirm true vs false positives and escalate true hits immediately.`,
    });
  }

  // Alert surge.
  if (s.alerts.newLast24h > 5) {
    out.push({
      priority: 'high',
      title: 'Alert volume is spiking',
      description: `${s.alerts.newLast24h} new alert${s.alerts.newLast24h === 1 ? '' : 's'} opened in the last 24h — above normal throughput. Investigate for a common root cause (new merchant, corridor, or attack pattern).`,
    });
  }

  // Quiet queue.
  if (out.length === 0) {
    out.push({
      priority: 'normal',
      title: 'Compliance queue is calm',
      description: `Only ${s.alerts.open} open alert${s.alerts.open === 1 ? '' : 's'} and ${s.kyc.pending} pending KYC review${s.kyc.pending === 1 ? '' : 's'}. Use this window to close out ${s.closedLast7d} recently-resolved cases and document playbooks.`,
    });
  }

  return out.slice(0, 3);
}
