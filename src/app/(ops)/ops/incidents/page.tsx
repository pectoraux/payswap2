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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import {
  AlertTriangle,
  Clock,
  CalendarDays,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { CreateIncidentDialog } from '@/components/incidents/create-incident-dialog';
import { IncidentFilters } from '@/components/incidents/incident-filters';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** Tailwind classes for each severity badge. */
const SEVERITY_CLASS: Record<string, string> = {
  P1: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15',
  P2: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15',
  P3: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-transparent hover:bg-sky-500/15',
  P4: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-500/15',
};

/** Tailwind classes for each incident status. */
const STATUS_CLASS: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15',
  investigating: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15',
  identified: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-transparent hover:bg-sky-500/15',
  monitoring: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-transparent hover:bg-teal-500/15',
  resolved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-500/15',
};

function SeverityBadge({ value }: { value: string }) {
  const cls = SEVERITY_CLASS[value] ?? SEVERITY_CLASS.P4;
  return (
    <Badge variant="secondary" className={`text-[10px] font-semibold uppercase ${cls}`}>
      {value}
    </Badge>
  );
}

function StatusPill({ value }: { value: string }) {
  const cls = STATUS_CLASS[value] ?? '';
  return (
    <Badge variant="secondary" className={`text-[10px] font-medium capitalize ${cls}`}>
      {value}
    </Badge>
  );
}

interface IncidentListPageProps {
  searchParams: Promise<{ status?: string; severity?: string }>;
}

export default async function IncidentsPage({ searchParams }: IncidentListPageProps) {
  const session = await getServerSession(authOptions);
  const sp = await searchParams;

  const statusParam = sp.status?.trim().toLowerCase();
  const severityParam = sp.severity?.trim().toUpperCase();

  // Build the where clause. "open" = anything not resolved.
  const where: Prisma.IncidentWhereInput = {};
  if (statusParam === 'open') {
    where.NOT = { status: 'resolved' };
  } else if (statusParam === 'resolved') {
    where.status = 'resolved';
  } else if (statusParam) {
    where.status = statusParam;
  }
  if (severityParam && ['P1', 'P2', 'P3', 'P4'].includes(severityParam)) {
    where.severity = severityParam;
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [incidents, openIncidents, thisWeek, resolved] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.incident.findMany({
      where: { status: { not: 'resolved' } },
      select: { severity: true },
    }),
    db.incident.count({ where: { createdAt: { gte: weekAgo } } }),
    db.incident.findMany({
      where: {
        status: 'resolved',
        resolvedAt: { not: null },
        createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { createdAt: true, resolvedAt: true },
    }),
  ]);

  // Compute avg resolution time over the last 30 days (hours).
  let avgResolutionHours = 0;
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((sum, r) => {
      if (!r.resolvedAt) return sum;
      return sum + (r.resolvedAt.getTime() - r.createdAt.getTime());
    }, 0);
    avgResolutionHours = totalMs / resolved.length / (1000 * 60 * 60);
  }

  const openBySeverity: Record<string, number> = {
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  };
  for (const i of openIncidents) {
    const sev = (i.severity || 'P2').toUpperCase();
    if (openBySeverity[sev] !== undefined) openBySeverity[sev]++;
  }

  // session is unused beyond ensuring auth (the layout already gates on
  // OPERATIONS/ADMIN role); reference it to satisfy the linter.
  void session;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        description="Track, triage and resolve platform incidents."
        action={<CreateIncidentDialog />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open incidents"
          value={openIncidents.length.toString()}
          hint={`P1: ${openBySeverity.P1} · P2: ${openBySeverity.P2} · P3: ${openBySeverity.P3} · P4: ${openBySeverity.P4}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={openBySeverity.P1 > 0 ? 'rose' : 'amber'}
        />
        <KpiCard
          label="Avg resolution"
          value={
            resolved.length === 0
              ? '—'
              : avgResolutionHours < 1
              ? `${Math.round(avgResolutionHours * 60)}m`
              : `${avgResolutionHours.toFixed(1)}h`
          }
          hint="Last 30 days"
          icon={<Clock className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="This week"
          value={thisWeek.toString()}
          hint="New incidents opened"
          icon={<CalendarDays className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Resolved (30d)"
          value={resolved.length.toString()}
          hint="Incidents closed"
          icon={<Activity className="h-4 w-4" />}
          tone="emerald"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">All incidents</CardTitle>
              <CardDescription>
                {incidents.length} incident{incidents.length === 1 ? '' : 's'} matching the current filters
              </CardDescription>
            </div>
            <IncidentFilters />
          </div>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="h-6 w-6" />}
              title="No incidents found"
              description="Use “Create Incident” to log a new ops incident, or adjust the filters above."
            />
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((i) => (
                    <TableRow key={i.id} className="cursor-pointer">
                      <TableCell>
                        <Link
                          href={`/ops/incidents/${i.id}`}
                          className="block max-w-[20rem] truncate text-sm font-semibold hover:text-emerald-600 dark:hover:text-emerald-400"
                        >
                          {i.title}
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {i.id.slice(0, 12)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/ops/incidents/${i.id}`}>
                          <SeverityBadge value={i.severity} />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/ops/incidents/${i.id}`}>
                          <StatusPill value={i.status} />
                        </Link>
                      </TableCell>
                      <TableCell>
                        {i.component ? (
                          <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium capitalize text-teal-600 dark:text-teal-400">
                            {i.component}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(i.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {i.assignedTo ? i.assignedTo.slice(0, 10) : <span className="text-muted-foreground">unassigned</span>}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/ops/incidents/${i.id}`}
                          className="inline-flex items-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                          aria-label="View incident"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
