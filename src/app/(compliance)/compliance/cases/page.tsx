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

export const dynamic = 'force-dynamic';

export default async function ComplianceCasesPage() {
  const session = await getServerSession(authOptions);

  const cases = await db.sAR.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const draft = cases.filter((c) => c.status === 'DRAFT').length;
  const filed = cases.filter((c) => c.status === 'FILED').length;
  const totalAmount = cases.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cases"
        description="Suspicious Activity Reports (SARs) and investigations."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total cases"
          value={cases.length.toString()}
          icon={<FolderOpen className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="In draft"
          value={draft.toString()}
          icon={<FileText className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Filed"
          value={filed.toString()}
          icon={<Send className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Total amount"
          value={fmtCurrency(totalAmount, 'USD')}
          hint="Across cases"
          icon={<Clock className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All cases</CardTitle>
          <CardDescription>
            {cases.length} case{cases.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cases.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title="No cases yet"
              description="When suspicious activity escalates to a formal case, it will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Narrative</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Filed</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {c.id.slice(0, 12)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {c.narrative}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtCurrency(c.amount, 'USD')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(c.filedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(c.createdAt)}
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
