import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import {
  ArrowLeft,
  History,
  Shield,
  Clock,
  CheckCircle2,
  UserCheck,
  Activity,
} from 'lucide-react';
import { AddUpdateForm } from '@/components/incidents/add-update-form';
import { IncidentActions } from '@/components/incidents/incident-actions';

export const dynamic = 'force-dynamic';

/** Tailwind classes for each severity badge. */
const SEVERITY_CLASS: Record<string, string> = {
  P1: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15',
  P2: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15',
  P3: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-transparent hover:bg-sky-500/15',
  P4: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-500/15',
};

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent hover:bg-rose-500/15',
  investigating: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-500/15',
  identified: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-transparent hover:bg-sky-500/15',
  monitoring: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-transparent hover:bg-teal-500/15',
  resolved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-500/15',
};

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card/50 p-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

interface IncidentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function IncidentDetailPage({
  params,
}: IncidentDetailPageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!id) notFound();

  const incident = await db.incident.findUnique({
    where: { id },
    include: {
      updates: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!incident) notFound();

  // Related audit logs — broad contains search on the JSON `details`
  // column then a JS filter for a precise match on the incident ID.
  const candidateLogs = await db.auditLog.findMany({
    where: {
      OR: [
        { resourceId: id },
        { details: { contains: id, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: true },
  });

  const relatedLogs = candidateLogs.filter((l) => {
    if (l.resourceId === id) return true;
    try {
      const d = JSON.parse(l.details ?? '{}');
      return JSON.stringify(d).includes(id);
    } catch {
      return false;
    }
  });

  const isResolved = incident.status === 'resolved';
  const isAcknowledged = incident.acknowledgedAt !== null;
  const isAssigned = incident.assignedTo !== null && incident.assignedTo !== '';

  // session.userId isn't used directly in the render — the assign action
  // server-side resolves the current user. Reference to keep the linter
  // happy about the unused import.
  void session;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs">
        <Link
          href="/ops/incidents"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to incidents
        </Link>
      </div>

      <PageHeader
        title={incident.title}
        description={`Incident ${incident.id}`}
        action={
          <IncidentActions
            incidentId={incident.id}
            acknowledged={isAcknowledged}
            resolved={isResolved}
            assigned={isAssigned}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className={`text-[10px] font-semibold uppercase ${
            SEVERITY_CLASS[incident.severity] ?? SEVERITY_CLASS.P4
          }`}
        >
          {incident.severity}
        </Badge>
        <Badge
          variant="secondary"
          className={`text-[10px] font-medium capitalize ${
            STATUS_CLASS[incident.status] ?? ''
          }`}
        >
          {incident.status}
        </Badge>
        {incident.component && (
          <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium capitalize text-teal-600 dark:text-teal-400">
            {incident.component}
          </span>
        )}
      </div>

      {incident.description && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {incident.description}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailRow icon={<Clock className="h-4 w-4" />} label="Created">
          <div className="font-medium">{fmtDate(incident.createdAt)}</div>
          <div className="text-[10px] text-muted-foreground">
            by {incident.createdBy.slice(0, 10)}
          </div>
        </DetailRow>
        <DetailRow icon={<Shield className="h-4 w-4" />} label="Acknowledged">
          {isAcknowledged ? (
            <div className="font-medium">{fmtDate(incident.acknowledgedAt)}</div>
          ) : (
            <span className="text-muted-foreground italic">Not acknowledged</span>
          )}
        </DetailRow>
        <DetailRow icon={<UserCheck className="h-4 w-4" />} label="Assigned">
          {isAssigned ? (
            <div className="font-mono text-xs font-medium">{incident.assignedTo!.slice(0, 14)}</div>
          ) : (
            <span className="text-muted-foreground italic">Unassigned</span>
          )}
        </DetailRow>
        <DetailRow icon={<CheckCircle2 className="h-4 w-4" />} label="Resolved">
          {isResolved ? (
            <div className="font-medium">{fmtDate(incident.resolvedAt)}</div>
          ) : (
            <span className="text-muted-foreground italic">In progress</span>
          )}
        </DetailRow>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <CardTitle className="text-base">Timeline</CardTitle>
                <CardDescription>
                  {incident.updates.length} update
                  {incident.updates.length === 1 ? '' : 's'} posted
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {incident.updates.length === 0 ? (
              <EmptyState
                icon={<History className="h-6 w-6" />}
                title="No updates yet"
                description="Post the first update below to start the incident timeline."
              />
            ) : (
              <ol className="relative space-y-4 border-l border-emerald-500/30 pl-4">
                {incident.updates.map((u, idx) => (
                  <li key={u.id} className="relative">
                    <span
                      className={`absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background ${
                        u.status === 'resolved'
                          ? 'bg-emerald-500'
                          : u.status === 'monitoring'
                          ? 'bg-teal-500'
                          : u.status === 'identified'
                          ? 'bg-sky-500'
                          : 'bg-amber-500'
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-semibold">
                        Update {idx + 1}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] font-medium capitalize ${
                          STATUS_CLASS[u.status] ?? ''
                        }`}
                      >
                        {u.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {fmtDate(u.createdAt)} · by {u.authorId.slice(0, 10)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{u.message}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Add update */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <CardTitle className="text-base">Add update</CardTitle>
                <CardDescription>Append to the timeline</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <AddUpdateForm incidentId={incident.id} />
          </CardContent>
        </Card>
      </div>

      {/* Related audit logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Related audit logs</CardTitle>
              <CardDescription>
                Entries whose details reference this incident
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {relatedLogs.length === 0 ? (
            <EmptyState
              icon={<Shield className="h-6 w-6" />}
              title="No related audit entries"
              description="Audit log entries tied to this incident will appear here as it is updated."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatedLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {l.action}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            l.result === 'SUCCESS'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : l.result === 'ERROR' || l.result === 'FAILURE'
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {l.result}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.user?.email ?? l.userId?.slice(0, 10) ?? 'system'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(l.createdAt)}
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
