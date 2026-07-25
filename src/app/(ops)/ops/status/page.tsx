import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  ArrowRight,
  Shield,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const COMPONENTS = [
  { id: 'api', label: 'API' },
  { id: 'payments', label: 'Payments' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'blockchain', label: 'Blockchain' },
] as const;

const UPTIME_DAYS = 30;

type ComponentStatus = 'operational' | 'degraded' | 'down';
type OverallStatus = 'operational' | 'degraded' | 'major';

/** Tailwind classes for each component status pill. */
const COMPONENT_STATUS_CLASS: Record<ComponentStatus, string> = {
  operational:
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-500/15',
  degraded:
    'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15',
  down: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15',
};

const UPTIME_BAR_CLASS: Record<ComponentStatus, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-rose-500',
};

const OVERALL_CONFIG: Record<
  OverallStatus,
  { label: string; tone: string; icon: typeof CheckCircle2 }
> = {
  operational: {
    label: 'All Systems Operational',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Partial Degradation',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: AlertTriangle,
  },
  major: {
    label: 'Major Outage',
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    icon: XCircle,
  },
};

/**
 * Compute a per-component status from the last 30 days of incidents.
 *
 * - If there's an unresolved P1 incident on the component → 'down'
 * - Else if there's any unresolved incident (P2 or higher) → 'degraded'
 * - Else if there was a resolved P1 in the last 30 days → 'degraded'
 * - Else 'operational'
 */
function computeComponentStatus(
  componentId: string,
  openIncidents: Array<{ severity: string; status: string; component: string | null }>,
  recentResolved: Array<{ severity: string; status: string; component: string | null }>,
): ComponentStatus {
  const openForComponent = openIncidents.filter(
    (i) => i.component === componentId,
  );
  if (openForComponent.some((i) => i.severity === 'P1')) return 'down';
  if (openForComponent.length > 0) return 'degraded';

  const resolvedForComponent = recentResolved.filter(
    (i) => i.component === componentId,
  );
  if (resolvedForComponent.some((i) => i.severity === 'P1')) return 'degraded';

  return 'operational';
}

/**
 * Compute the per-day uptime status for a component over the last N days.
 * We only have incident data, so each day is marked by the worst incident
 * that was open on that day. Days with no incidents are operational.
 */
function computeUptimeBars(
  componentId: string,
  incidents: Array<{
    severity: string;
    status: string;
    component: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }>,
  days: number,
): ComponentStatus[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bars: ComponentStatus[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

    // Incidents that overlap this day for this component.
    const overlapping = incidents.filter((i) => {
      if (i.component !== componentId) return false;
      const start = i.createdAt.getTime();
      const end = i.resolvedAt ? i.resolvedAt.getTime() : dayEnd.getTime();
      return start < dayEnd && end > day.getTime();
    });

    if (overlapping.some((i) => i.severity === 'P1' && i.status !== 'resolved')) {
      bars.push('down');
    } else if (overlapping.length > 0) {
      bars.push('degraded');
    } else {
      bars.push('operational');
    }
  }
  return bars;
}

export default async function StatusPage() {
  const session = await getServerSession(authOptions);
  void session;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - UPTIME_DAYS * 24 * 60 * 60 * 1000);

  const [openIncidents, recentResolved, recentIncidentsForUptime] =
    await Promise.all([
      db.incident.findMany({
        where: { status: { not: 'resolved' } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          severity: true,
          status: true,
          component: true,
          createdAt: true,
        },
      }),
      db.incident.findMany({
        where: {
          status: 'resolved',
          resolvedAt: { gte: thirtyDaysAgo },
        },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          severity: true,
          status: true,
          component: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      db.incident.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          severity: true,
          status: true,
          component: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
    ]);

  // Compute per-component status.
  const componentStatuses: Array<{
    id: string;
    label: string;
    status: ComponentStatus;
    bars: ComponentStatus[];
    uptimePct: number;
  }> = COMPONENTS.map((c) => {
    const status = computeComponentStatus(
      c.id,
      openIncidents,
      recentResolved,
    );
    const bars = computeUptimeBars(c.id, recentIncidentsForUptime, UPTIME_DAYS);
    const operationalDays = bars.filter((b) => b === 'operational').length;
    const uptimePct = (operationalDays / UPTIME_DAYS) * 100;
    return { id: c.id, label: c.label, status, bars, uptimePct };
  });

  // Overall status: any 'down' → major, any 'degraded' → degraded, else operational.
  let overall: OverallStatus = 'operational';
  if (componentStatuses.some((c) => c.status === 'down')) {
    overall = 'major';
  } else if (componentStatuses.some((c) => c.status === 'degraded')) {
    overall = 'degraded';
  }

  const overallCfg = OVERALL_CONFIG[overall];
  const OverallIcon = overallCfg.icon;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Status page"
        description="Live platform status derived from open and recent incidents."
      />

      {/* Overall banner */}
      <Card className={`border ${overallCfg.tone}`}>
        <CardContent className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <OverallIcon className="h-6 w-6" />
            <div>
              <div className="text-lg font-semibold">{overallCfg.label}</div>
              <div className="text-xs opacity-80">
                Updated {fmtDate(now)} · derived from {openIncidents.length} open and {recentResolved.length} recently resolved incident
                {recentResolved.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <Badge
            variant="secondary"
            className={`text-[10px] font-semibold uppercase ${overallCfg.tone}`}
          >
            {overall}
          </Badge>
        </CardContent>
      </Card>

      {/* Component status list */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Component status</CardTitle>
              <CardDescription>
                Per-component health across the platform
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {componentStatuses.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-lg border bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    c.status === 'operational'
                      ? 'bg-emerald-500'
                      : c.status === 'degraded'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                />
                <div>
                  <div className="text-sm font-semibold">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.uptimePct.toFixed(2)}% uptime · last {UPTIME_DAYS} days
                  </div>
                </div>
              </div>

              <div className="flex flex-1 items-center gap-3 sm:max-w-md sm:justify-end">
                {/* Uptime bars */}
                <div className="flex h-7 flex-1 items-end gap-[2px] overflow-hidden sm:max-w-xs">
                  {c.bars.map((b, idx) => (
                    <div
                      key={idx}
                      className={`flex-1 rounded-sm ${UPTIME_BAR_CLASS[b]}`}
                      style={{ height: '100%' }}
                      title={`Day ${idx + 1}: ${b}`}
                    />
                  ))}
                </div>

                <Badge
                  variant="secondary"
                  className={`text-[10px] font-medium capitalize ${
                    COMPONENT_STATUS_CLASS[c.status]
                  }`}
                >
                  {c.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent incidents */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Recent incidents</CardTitle>
              <CardDescription>
                Last 10 resolved incidents
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {recentResolved.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="No resolved incidents"
              description="When incidents are resolved they will appear here for visibility."
            />
          ) : (
            <ul className="divide-y">
              {recentResolved.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/ops/incidents/${i.id}`}
                      className="block max-w-md truncate text-sm font-semibold hover:text-emerald-600 dark:hover:text-emerald-400"
                    >
                      {i.title}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">
                      {i.component ?? 'general'} · resolved {fmtDate(i.resolvedAt)} · opened {fmtDate(i.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-semibold uppercase ${
                        i.severity === 'P1'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15'
                          : i.severity === 'P2'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15'
                          : i.severity === 'P3'
                          ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-transparent hover:bg-sky-500/15'
                          : 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-500/15'
                      }`}
                    >
                      {i.severity}
                    </Badge>
                    <Link
                      href={`/ops/incidents/${i.id}`}
                      className="inline-flex items-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      aria-label="View incident"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
