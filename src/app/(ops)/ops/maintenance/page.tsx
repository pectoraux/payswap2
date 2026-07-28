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
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import { CalendarDays, Play, CheckCircle2, Wrench } from 'lucide-react';
import { opsEngine } from '@/ops';
import type { MaintenanceWindow } from '@/ops/types';
import { MaintenanceActions } from '@/components/ops/maintenance-actions';
import { ScheduleMaintenanceDialog } from '@/components/ops/schedule-maintenance-dialog';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  scheduled: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  in_progress: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
};

const IMPACT_CLASS: Record<string, string> = {
  none: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  minor: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  major: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  outage: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

function MaintenanceRow({ m }: { m: MaintenanceWindow }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{m.title}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {m.description}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge
            variant="secondary"
            className={`text-[10px] font-medium capitalize ${
              STATUS_CLASS[m.status] ?? ''
            }`}
          >
            {m.status.replace('_', ' ')}
          </Badge>
          <Badge
            variant="secondary"
            className={`text-[10px] font-medium capitalize ${
              IMPACT_CLASS[m.impact] ?? ''
            }`}
          >
            {m.impact}
          </Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-medium text-teal-600 dark:text-teal-400">
          {m.component}
        </span>
        <span>starts {fmtDate(new Date(m.startAt))}</span>
        <span>→ ends {fmtDate(new Date(m.endAt))}</span>
        <span>· by {m.createdBy}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MaintenanceActions window={m} />
      </div>
    </div>
  );
}

export default async function MaintenancePage() {
  const [upcoming, active, all] = await Promise.all([
    opsEngine.maintenance.getUpcoming(),
    opsEngine.maintenance.getActive(),
    opsEngine.maintenance.list(),
  ]);

  const past = all
    .filter(
      (m) => m.status === 'completed' || m.status === 'cancelled',
    )
    .sort((a, b) => b.endAt - a.endAt);

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'Maintenance' },
        ]}
      />
      <PageHeader
        title="Maintenance windows"
        description="Schedule, start and complete planned maintenance windows."
        action={<ScheduleMaintenanceDialog />}
      />

      {/* Active maintenance banner */}
      {active && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <div>
                <CardTitle className="text-base">
                  Maintenance in progress: {active.title}
                </CardTitle>
                <CardDescription>
                  {active.component} · impact {active.impact} · ends{' '}
                  {fmtDate(new Date(active.endAt))}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MaintenanceActions window={active} />
          </CardContent>
        </Card>
      )}

      {/* Upcoming */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Upcoming</CardTitle>
              <CardDescription>
                {upcoming.length} scheduled window
                {upcoming.length === 1 ? '' : 's'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Nothing scheduled"
              description="Use “Schedule maintenance” to plan a window."
            />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {upcoming.map((m) => (
                <MaintenanceRow key={m.id} m={m} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past windows */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">History</CardTitle>
              <CardDescription>
                Recently completed and cancelled windows
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <EmptyState
              icon={<Play className="h-6 w-6" />}
              title="No history"
              description="Completed maintenance windows will appear here."
            />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {past.slice(0, 12).map((m) => (
                <MaintenanceRow key={m.id} m={m} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
