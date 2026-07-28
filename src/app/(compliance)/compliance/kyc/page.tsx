import Link from 'next/link';
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
import { Badge } from '@/components/ui/badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import { UserCheck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { KycTrustActions } from '@/components/compliance/kyc-trust-actions';
import { kycService } from '@/trust';

export const dynamic = 'force-dynamic';

export default async function ComplianceKycPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const typeFilter = sp.type as any;
  const statusFilter = sp.status as any;

  const verifications = await kycService.list({
    type: typeFilter,
    status: statusFilter,
  });
  const stats = await kycService.stats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="KYC / KYB review"
        description="Identity verification dossiers for individuals (KYC) and businesses (KYB)."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending"
          value={stats.pending + stats.inReview}
          hint={`${stats.inReview} in review`}
          icon={<Clock className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Approved"
          value={stats.approved}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Rejected"
          value={stats.rejected}
          icon={<XCircle className="h-4 w-4" />}
          tone="rose"
        />
        <KpiCard
          label="Expired"
          value={stats.expired}
          icon={<UserCheck className="h-4 w-4" />}
          tone="teal"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Verifications</CardTitle>
              <CardDescription>
                {verifications.length} verification
                {verifications.length === 1 ? '' : 's'} on record
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/kyc"
                label="All"
                active={!typeFilter}
              />
              <FilterChip
                href="/compliance/kyc?type=kyc"
                label="KYC (individual)"
                active={typeFilter === 'kyc'}
              />
              <FilterChip
                href="/compliance/kyc?type=kyb"
                label="KYB (business)"
                active={typeFilter === 'kyb'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {verifications.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="h-6 w-6" />}
              title="No verifications"
              description="When merchants or customers submit identity verification, the review will appear here."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Checks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Reviewed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verifications.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs">
                        {v.entityId.slice(0, 12)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            v.type === 'kyb'
                              ? 'border-violet-500/40 text-violet-600 dark:text-violet-400'
                              : 'border-teal-500/40 text-teal-600 dark:text-teal-400'
                          }
                        >
                          {v.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {v.documents.length} doc
                        {v.documents.length === 1 ? '' : 's'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {v.verifications.slice(0, 3).map((c, i) => (
                            <span
                              key={i}
                              className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase ${
                                c.status === 'pass'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : c.status === 'fail'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              }`}
                              title={c.detail ?? c.type}
                            >
                              {c.type}
                            </span>
                          ))}
                          {v.verifications.length > 3 && (
                            <span className="text-[9px] text-muted-foreground">
                              +{v.verifications.length - 3}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <KycStatusPill status={v.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(v.submittedAt))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.reviewedAt ? fmtDate(new Date(v.reviewedAt)) : '—'}
                      </TableCell>
                      <TableCell>
                        <KycTrustActions
                          verificationId={v.id}
                          status={v.status}
                        />
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

function KycStatusPill({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'rejected'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : status === 'expired'
      ? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
      : status === 'in_review'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-teal-500/10 text-teal-600 dark:text-teal-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-border text-muted-foreground hover:bg-accent/40'
      }`}
    >
      {label}
    </Link>
  );
}
