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
import { UserCheck, Phone, Calendar, Users } from 'lucide-react';
import { opsEngine } from '@/ops';
import type { OnCallSchedule } from '@/ops/types';

export const dynamic = 'force-dynamic';

const ROLE_CLASS: Record<string, string> = {
  primary: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  secondary: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  manager: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
};

function RosterCard({
  role,
  schedule,
}: {
  role: 'primary' | 'secondary' | 'manager';
  schedule?: OnCallSchedule;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base capitalize">{role}</CardTitle>
              <CardDescription>
                {schedule ? 'Currently on call' : 'No active rotation'}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="secondary"
            className={`text-[10px] font-semibold uppercase ${
              ROLE_CLASS[role] ?? ''
            }`}
          >
            {schedule?.isActive ? 'active' : 'idle'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {schedule ? (
          <>
            <div className="text-lg font-bold">{schedule.userName}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {schedule.userId}
            </div>
            <div className="mt-2 space-y-1 rounded-lg border bg-card/50 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Start</span>
                <span className="font-medium">
                  {fmtDate(new Date(schedule.startAt))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">End</span>
                <span className="font-medium">
                  {fmtDate(new Date(schedule.endAt))}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground italic">
            No one is currently assigned.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OnCallPage() {
  const now = Date.now();
  const from = now - 7 * 24 * 60 * 60 * 1000;
  const to = now + 14 * 24 * 60 * 60 * 1000;
  const [roster, schedule] = await Promise.all([
    opsEngine.onCall.getActiveRoster(),
    opsEngine.onCall.getSchedule(from, to),
  ]);

  // Group schedule entries by day for the timeline view.
  const upcoming = schedule
    .filter((s) => s.endAt > now)
    .sort((a, b) => a.startAt - b.startAt);

  return (
    <div className="space-y-6">
      <PageBreadcrumbs
        items={[
          { label: 'Operations', href: '/ops' },
          { label: 'On-call' },
        ]}
      />
      <PageHeader
        title="On-call"
        description="Current on-call rotation and the upcoming schedule."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <RosterCard role="primary" schedule={roster.primary} />
        <RosterCard role="secondary" schedule={roster.secondary} />
        <RosterCard role="manager" schedule={roster.manager} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <CardTitle className="text-base">Schedule</CardTitle>
                <CardDescription>
                  Upcoming rotations (next 14 days)
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="text-[10px] font-medium">
              {upcoming.length} shifts
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No upcoming shifts"
              description="The schedule is empty for the next 14 days."
            />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {upcoming.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border bg-card/50 p-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-semibold uppercase ${
                        ROLE_CLASS[s.role] ?? ''
                      }`}
                    >
                      {s.role}
                    </Badge>
                    <div>
                      <div className="text-sm font-semibold">
                        {s.userName}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {s.userId}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      <Phone className="h-3 w-3" />
                      {s.isActive ? 'active now' : 'upcoming'}
                    </div>
                    <div>
                      {fmtDate(new Date(s.startAt))} → {fmtDate(new Date(s.endAt))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
