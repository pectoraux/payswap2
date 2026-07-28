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
  fmtDate,
} from '@/components/role-ui';
import { UserCheck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { KycActions } from '@/components/compliance/kyc-actions';

export const dynamic = 'force-dynamic';

export default async function ComplianceKycPage() {
  const session = await getServerSession(authOptions);

  const reviews = await db.complianceReview.findMany({
    where: { type: 'KYC' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const pending = reviews.filter((r) => r.status === 'PENDING').length;
  const approved = reviews.filter((r) => r.status === 'APPROVED').length;
  const rejected = reviews.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="KYC review"
        description="Identity verification submissions awaiting compliance review."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending"
          value={pending.toString()}
          icon={<Clock className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Approved"
          value={approved.toString()}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Rejected"
          value={rejected.toString()}
          icon={<XCircle className="h-4 w-4" />}
          tone="rose"
        />
        <KpiCard
          label="Total"
          value={reviews.length.toString()}
          icon={<UserCheck className="h-4 w-4" />}
          tone="teal"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">KYC submissions</CardTitle>
          <CardDescription>
            {reviews.length} submission{reviews.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="h-6 w-6" />}
              title="No KYC submissions"
              description="When merchants or customers submit identity verification, the review will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.entityType}:{r.entityId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs">{r.type}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.reviewerId ? r.reviewerId.slice(0, 8) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(r.reviewedAt)}
                    </TableCell>
                    <TableCell>
                      <KycActions reviewId={r.id} status={r.status} />
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
