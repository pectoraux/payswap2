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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtDate,
} from '@/components/role-ui';
import { FolderOpen, FileText, Send, Clock } from 'lucide-react';
import { CaseActions } from '@/components/compliance/case-actions';
import { OpenCaseDialog } from '@/components/compliance/open-case-dialog';

export const dynamic = 'force-dynamic';

export default async function ComplianceCasesPage() {
  const session = await getServerSession(authOptions);

  const [cases, sars] = await Promise.all([
    db.complianceReview.findMany({
      where: { type: 'CASE' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.sAR.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const open = cases.filter((c) => c.status === 'OPEN').length;
  const escalated = cases.filter((c) => c.status === 'ESCALATED').length;
  const resolved = cases.filter(
    (c) => c.status === 'APPROVED' || c.status === 'REJECTED' || c.status === 'CLOSED',
  ).length;

  const sarsDraft = sars.filter((s) => s.status === 'DRAFT').length;
  const sarsFiled = sars.filter((s) => s.status === 'FILED').length;
  const sarsTotal = sars.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cases"
        description="Compliance investigations, SARs and case workflow."
        action={<OpenCaseDialog />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open cases"
          value={open.toString()}
          icon={<FolderOpen className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Escalated"
          value={escalated.toString()}
          icon={<FileText className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Resolved"
          value={resolved.toString()}
          icon={<Send className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="SAR amount"
          value={fmtCurrency(sarsTotal, 'USD')}
          hint={`${sarsFiled} filed · ${sarsDraft} draft`}
          icon={<Clock className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Investigation cases</CardTitle>
          <CardDescription>
            {cases.length} case{cases.length === 1 ? '' : 's'} opened through
            the compliance workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cases.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title="No cases opened"
              description="Use “Open Case” to start a new investigation tied to a payment, payout, merchant or alert."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {c.id.slice(0, 12)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-medium text-teal-600 dark:text-teal-400">
                        {c.entityType}
                      </span>{' '}
                      <span className="font-mono text-muted-foreground">
                        {c.entityId.slice(0, 10)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.reviewerId ? c.reviewerId.slice(0, 10) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(c.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(c.reviewedAt)}
                    </TableCell>
                    <TableCell>
                      <CaseActions caseId={c.id} status={c.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SARs filed</CardTitle>
          <CardDescription>
            {sars.length} suspicious activity report{sars.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sars.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title="No SARs yet"
              description="Filed SARs will appear here when suspicious activity escalates to a formal report."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SAR ID</TableHead>
                  <TableHead>Narrative</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Filed</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sars.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {s.id.slice(0, 12)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {s.narrative}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtCurrency(s.amount, 'USD')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(s.filedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(s.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
