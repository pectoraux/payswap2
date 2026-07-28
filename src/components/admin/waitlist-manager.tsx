'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Check, X, Loader2, Eye, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatRelative, statusBadgeClass } from '@/lib/format';

export interface WaitlistRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  country: string;
  businessType: string | null;
  accountType: string | null;
  useCase: string | null;
  monthlyVolume: string | null;
  referralSource: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_FILTERS = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Converted', value: 'CONVERTED' },
] as const;

const ACCOUNT_TYPE_FILTERS = [
  { label: 'All types', value: 'ALL' },
  { label: 'Merchant', value: 'MERCHANT' },
  { label: 'LP', value: 'LP' },
  { label: 'Developer', value: 'DEVELOPER' },
  { label: 'Customer', value: 'CUSTOMER' },
  { label: 'Other', value: 'OTHER' },
] as const;

type StatusFilterValue = (typeof STATUS_FILTERS)[number]['value'];
type AccountTypeFilterValue = (typeof ACCOUNT_TYPE_FILTERS)[number]['value'];

interface ApproveResult {
  userId: string;
  email: string;
  password: string | null;
  alreadyExisted: boolean;
  role: string;
  message: string;
}

interface Props {
  entries: WaitlistRow[];
}

export function WaitlistManager({ entries }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('ALL');
  const [accountTypeFilter, setAccountTypeFilter] =
    useState<AccountTypeFilterValue>('ALL');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  // local state for instant feedback
  const [localEntries, setLocalEntries] = useState<WaitlistRow[]>(entries);

  // Build the unique country list from the current entries.
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.country) set.add(e.country);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return localEntries.filter((e) => {
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (
        accountTypeFilter !== 'ALL' &&
        (e.accountType ?? 'OTHER') !== accountTypeFilter
      )
        return false;
      if (countryFilter !== 'ALL' && e.country !== countryFilter) return false;
      if (!q) return true;
      return [e.name, e.email, e.company, e.country, e.accountType, e.useCase]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [localEntries, statusFilter, accountTypeFilter, countryFilter, query]);

  const handleAction = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error || 'Action failed');
      }
      setLocalEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: action, reviewedAt: new Date().toISOString() }
            : e,
        ),
      );
      if (action === 'APPROVED' && j.approve) {
        setApproveResult(j.approve as ApproveResult);
        toast.success('Application approved — account created');
      } else {
        toast.success(`Entry ${action.toLowerCase()}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = async (pw: string) => {
    try {
      await navigator.clipboard.writeText(pw);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const detailsRow = detailsId
    ? localEntries.find((e) => e.id === detailsId) ?? null
    : null;

  return (
    <div className="space-y-3">
      {/* Filters + search */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Status:</span>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={statusFilter === f.value ? 'default' : 'outline'}
                className={
                  statusFilter === f.value
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : ''
                }
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <Select
            value={accountTypeFilter}
            onValueChange={(v) => setAccountTypeFilter(v as AccountTypeFilterValue)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Account type" />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPE_FILTERS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={countryFilter}
            onValueChange={(v) => setCountryFilter(v)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All countries</SelectItem>
              {countryOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, company…"
            className="h-9 sm:col-span-2"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No waitlist entries"
            description="When prospective users join the waitlist, they'll appear here for review."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Account type</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <div>{e.name}</div>
                    {e.company && (
                      <div className="text-[11px] text-muted-foreground">
                        {e.company}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {e.accountType ?? 'OTHER'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.country}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.monthlyVolume ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(e.status)}>
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(e.createdAt, true)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => setDetailsId(e.id)}
                        aria-label="View details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {e.status === 'PENDING' ? (
                        <>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                            onClick={() => handleAction(e.id, 'APPROVED')}
                            disabled={busyId === e.id}
                            aria-label="Approve"
                          >
                            {busyId === e.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                            onClick={() => handleAction(e.id, 'REJECTED')}
                            disabled={busyId === e.id}
                            aria-label="Reject"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {e.reviewedAt ? formatRelative(e.reviewedAt) : '—'}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Showing {filtered.length} of {localEntries.length} entries
        </div>
      )}

      {/* ── Details dialog ── */}
      <Dialog
        open={!!detailsRow}
        onOpenChange={(o) => !o && setDetailsId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Application details</DialogTitle>
            <DialogDescription>
              Submitted {detailsRow && formatDate(detailsRow.createdAt, true)}
            </DialogDescription>
          </DialogHeader>
          {detailsRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" value={detailsRow.name} />
                <Field label="Email" value={detailsRow.email} />
                <Field label="Company" value={detailsRow.company ?? '—'} />
                <Field label="Country" value={detailsRow.country} />
                <Field
                  label="Account type"
                  value={detailsRow.accountType ?? 'OTHER'}
                />
                <Field
                  label="Monthly volume"
                  value={detailsRow.monthlyVolume ?? '—'}
                />
                <Field
                  label="Referral source"
                  value={detailsRow.referralSource ?? '—'}
                />
                <Field
                  label="Status"
                  value={detailsRow.status}
                />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Use case
                </div>
                <p className="mt-1 rounded-md border bg-muted/30 p-3 text-sm">
                  {detailsRow.useCase ?? '—'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            {detailsRow?.status === 'PENDING' && (
              <div className="flex w-full justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                  onClick={() => {
                    if (!detailsRow) return;
                    handleAction(detailsRow.id, 'REJECTED');
                    setDetailsId(null);
                  }}
                  disabled={busyId === detailsRow?.id}
                >
                  Reject
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => {
                    if (!detailsRow) return;
                    handleAction(detailsRow.id, 'APPROVED');
                    setDetailsId(null);
                  }}
                  disabled={busyId === detailsRow?.id}
                >
                  {busyId === detailsRow?.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Approve
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approve result dialog ── */}
      <Dialog
        open={!!approveResult}
        onOpenChange={(o) => !o && setApproveResult(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              Account created
            </DialogTitle>
            <DialogDescription>
              {approveResult?.alreadyExisted
                ? 'A user with this email already existed.'
                : 'A new user account has been created. Send the credentials below to the applicant.'}
            </DialogDescription>
          </DialogHeader>
          {approveResult && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email" value={approveResult.email} />
                <Field label="Role" value={approveResult.role} />
                {!approveResult.alreadyExisted && (
                  <div className="col-span-2">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Temporary password
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 rounded-md border bg-muted/30 p-2 font-mono text-sm">
                        {approveResult.password}
                      </code>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() =>
                          approveResult.password &&
                          copyPassword(approveResult.password)
                        }
                        aria-label="Copy password"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The applicant can sign in at{' '}
                <a
                  href="/login"
                  className="font-medium text-emerald-600 hover:underline"
                >
                  /login
                </a>{' '}
                using these credentials. They should change their password after
                first login.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setApproveResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 break-words text-sm">{value}</div>
    </div>
  );
}
