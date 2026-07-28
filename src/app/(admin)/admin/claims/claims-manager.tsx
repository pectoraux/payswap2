'use client';

import { useState, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ShieldAlert,
  Scale,
  Gavel,
  ThumbsUp,
  ThumbsDown,
  Search,
  Loader2,
  Inbox,
  FileText,
  Link2,
  MessageSquare,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ClaimType =
  | 'unauthorized_transaction'
  | 'duplicate_charge'
  | 'product_not_received'
  | 'product_not_as_described'
  | 'incorrect_amount'
  | 'refund_not_processed'
  | 'fraud'
  | 'settlement_failure'
  | 'other';

export type ClaimStatus =
  | 'open'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'vetoed'
  | 'resolved';

export type EvidenceType =
  | 'text'
  | 'file_reference'
  | 'screenshot'
  | 'transaction_log'
  | 'communication'
  | 'other';

export type VoteChoice = 'support' | 'reject';

export type ResolutionDecision = 'approved' | 'rejected' | 'vetoed';

export interface EvidenceDTO {
  id: string;
  claimId: string;
  type: EvidenceType;
  description: string;
  reference?: string;
  submittedByUserId?: string;
  submittedByEmail?: string;
  submittedAt: string;
}

export interface VoteDTO {
  id: string;
  claimId: string;
  vote: VoteChoice;
  comment?: string;
  voterUserId?: string;
  voterEmail?: string;
  votedAt: string;
}

export interface ResolutionDTO {
  decision: ResolutionDecision;
  notes?: string;
  resolvedByUserId?: string;
  resolvedByEmail?: string;
  resolvedAt: string;
  communityTally: { support: number; reject: number };
}

export interface ClaimDTO {
  id: string;
  transactionId: string;
  type: ClaimType;
  description: string;
  status: ClaimStatus;
  claimantUserId?: string;
  claimantEmail?: string;
  merchantId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  resolution?: ResolutionDTO | null;
  evidence: EvidenceDTO[];
  votes: VoteDTO[];
}

export interface ClaimsOverview {
  total: number;
  open: number;
  underReview: number;
  approved: number;
  rejected: number;
  vetoed: number;
  resolved: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  vetoed: 'Vetoed',
  resolved: 'Resolved',
};

const STATUS_CLS: Record<ClaimStatus, string> = {
  open: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent',
  under_review: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-transparent',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent',
  rejected: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent',
  vetoed: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-transparent',
  resolved: 'bg-muted text-muted-foreground border-transparent',
};

const TYPE_LABEL: Record<ClaimType, string> = {
  unauthorized_transaction: 'Unauthorized txn',
  duplicate_charge: 'Duplicate charge',
  product_not_received: 'Product not received',
  product_not_as_described: 'Product not as described',
  incorrect_amount: 'Incorrect amount',
  refund_not_processed: 'Refund not processed',
  fraud: 'Fraud',
  settlement_failure: 'Settlement failure',
  other: 'Other',
};

const EVIDENCE_ICON: Record<EvidenceType, typeof FileText> = {
  text: FileText,
  file_reference: FileText,
  screenshot: Link2,
  transaction_log: FileText,
  communication: MessageSquare,
  other: FileText,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(s);
  }
}

function statusBadge(s: ClaimStatus) {
  return (
    <Badge className={`text-[10px] font-medium ${STATUS_CLS[s] ?? ''}`}>
      {STATUS_LABEL[s] ?? s}
    </Badge>
  );
}

function tally(votes: VoteDTO[]) {
  return {
    support: votes.filter((v) => v.vote === 'support').length,
    reject: votes.filter((v) => v.vote === 'reject').length,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface AdminClaimsManagerProps {
  initial: ClaimDTO[];
  overview: ClaimsOverview;
}

export function AdminClaimsManager({
  initial,
  overview: initialOverview,
}: AdminClaimsManagerProps) {
  const [claims, setClaims] = useState<ClaimDTO[]>(initial);
  const [overview, setOverview] = useState<ClaimsOverview>(initialOverview);
  const [filterStatus, setFilterStatus] = useState<ClaimStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ClaimDTO | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [decision, setDecision] = useState<ResolutionDecision>('vetoed');
  const [notes, setNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  const filtered = useMemo(() => {
    let rows = claims;
    if (filterStatus !== 'all') rows = rows.filter((c) => c.status === filterStatus);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          c.transactionId.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          (c.claimantEmail ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [claims, filterStatus, query]);

  function openDetail(c: ClaimDTO) {
    setSelected(c);
  }

  async function refreshSelected(id: string) {
    try {
      const res = await fetch(`/api/claims/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setSelected(data.claim);
      }
    } catch {
      // ignore
    }
  }

  async function confirmResolve() {
    if (!selected) return;
    setResolving(true);
    try {
      const res = await fetch(
        `/api/claims/${encodeURIComponent(selected.id)}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, notes: notes.trim() || undefined }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Resolve failed (${res.status})`);
      }
      toast.success(`Claim ${decision}`);
      // Update the local list + selected.
      const updated: ClaimDTO = data.claim;
      setClaims((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSelected(updated);
      // Rebuild overview from the new list.
      setOverview((prev) => {
        const next = { ...prev };
        // Recount.
        const arr = claims.map((c) => (c.id === updated.id ? updated : c));
        next.open = arr.filter((c) => c.status === 'open').length;
        next.underReview = arr.filter((c) => c.status === 'under_review').length;
        next.approved = arr.filter((c) => c.status === 'approved').length;
        next.rejected = arr.filter((c) => c.status === 'rejected').length;
        next.vetoed = arr.filter((c) => c.status === 'vetoed').length;
        next.resolved = arr.filter((c) => c.status === 'resolved').length;
        return next;
      });
      setResolveOpen(false);
      setNotes('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open
              </span>
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {overview.open}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Awaiting triage
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Under review
              </span>
              <Scale className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {overview.underReview}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Community voting in progress
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Vetoed
              </span>
              <Gavel className="h-4 w-4 text-violet-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {overview.vetoed}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Admin overrode community vote
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Resolved (all)
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {overview.approved + overview.rejected + overview.vetoed + overview.resolved}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Approved / rejected / vetoed / resolved
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Claims table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">All claims</CardTitle>
              <CardDescription>
                {filtered.length} claim{filtered.length === 1 ? '' : 's'} in this view
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as ClaimStatus | 'all')}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="under_review">Under review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="vetoed">Vetoed</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search claims…"
                  className="h-9 w-[200px] pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Inbox className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-medium">No claims match this filter</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Adjust the status filter or search query to see more claims.
              </p>
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Claimant</TableHead>
                    <TableHead>Votes (S/R)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const t = tally(c.votes);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">
                          {c.id.slice(0, 12)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.transactionId}
                        </TableCell>
                        <TableCell className="text-xs">
                          {TYPE_LABEL[c.type]}
                        </TableCell>
                        <TableCell className="text-xs">
                          {c.claimantEmail ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {t.support}
                          </span>
                          {' / '}
                          <span className="text-rose-600 dark:text-rose-400">
                            {t.reject}
                          </span>
                        </TableCell>
                        <TableCell>{statusBadge(c.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(c.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openDetail(c)}
                          >
                            Review
                            <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  {statusBadge(selected.status)}
                  <span className="font-mono text-base">{selected.id.slice(0, 16)}</span>
                </SheetTitle>
                <SheetDescription>
                  Dispute on transaction{' '}
                  <span className="font-mono text-foreground">
                    {selected.transactionId}
                  </span>{' '}
                  · created {fmtDate(selected.createdAt)} by{' '}
                  <span className="text-foreground">
                    {selected.claimantEmail ?? '—'}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-5 px-4 pb-6">
                {/* Description */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Type · Description
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {TYPE_LABEL[selected.type]}
                    </Badge>
                  </div>
                  <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                    {selected.description}
                  </p>
                </div>

                {/* Resolution banner (if any) */}
                {selected.resolution && (
                  <div
                    className={`rounded-lg border p-3 text-sm ${
                      selected.resolution.decision === 'approved'
                        ? 'border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-700 dark:text-emerald-300'
                        : selected.resolution.decision === 'vetoed'
                          ? 'border-violet-500/30 bg-violet-500/[0.04] text-violet-700 dark:text-violet-300'
                          : 'border-rose-500/30 bg-rose-500/[0.04] text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {selected.resolution.decision === 'approved' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : selected.resolution.decision === 'vetoed' ? (
                        <Gavel className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      <span className="capitalize">
                        {selected.resolution.decision}
                      </span>
                      <span className="text-xs font-normal opacity-80">
                        · by{' '}
                        {selected.resolution.resolvedByEmail ?? 'admin'} ·{' '}
                        {fmtDate(selected.resolution.resolvedAt)}
                      </span>
                    </div>
                    {selected.resolution.notes && (
                      <p className="mt-1 text-xs">{selected.resolution.notes}</p>
                    )}
                    <div className="mt-1 text-[11px] opacity-80">
                      Community tally at resolution:{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {selected.resolution.communityTally.support} support
                      </span>{' '}
                      ·{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        {selected.resolution.communityTally.reject} reject
                      </span>
                    </div>
                  </div>
                )}

                {/* Community tally */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Community tally
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-emerald-500/[0.04] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        <ThumbsUp className="h-3 w-3" /> Support
                      </div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {tally(selected.votes).support}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-rose-500/[0.04] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
                        <ThumbsDown className="h-3 w-3" /> Reject
                      </div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {tally(selected.votes).reject}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Evidence */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Evidence ({selected.evidence.length})
                  </div>
                  {selected.evidence.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No evidence submitted yet.
                    </p>
                  ) : (
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                      {selected.evidence.map((e) => {
                        const Icon = EVIDENCE_ICON[e.type] ?? FileText;
                        return (
                          <div
                            key={e.id}
                            className="rounded-lg border bg-card p-3 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium capitalize">
                                {e.type.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                · {fmtDate(e.submittedAt)} ·{' '}
                                {e.submittedByEmail ?? '—'}
                              </span>
                            </div>
                            <p className="mt-1.5 text-foreground">{e.description}</p>
                            {e.reference && (
                              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                                → {e.reference}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Votes */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Votes ({selected.votes.length})
                  </div>
                  {selected.votes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No votes cast yet.
                    </p>
                  ) : (
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                      {selected.votes.map((v) => (
                        <div
                          key={v.id}
                          className={`rounded-lg border p-3 text-xs ${
                            v.vote === 'support'
                              ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                              : 'border-rose-500/30 bg-rose-500/[0.04]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {v.vote === 'support' ? (
                              <ThumbsUp className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <ThumbsDown className="h-3.5 w-3.5 text-rose-500" />
                            )}
                            <span className="font-medium capitalize">
                              {v.vote}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              · {fmtDate(v.votedAt)} ·{' '}
                              {v.voterEmail ?? '—'}
                            </span>
                          </div>
                          {v.comment && (
                            <p className="mt-1.5 text-foreground">{v.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Resolve / Veto actions */}
                {selected.status !== 'resolved' &&
                  selected.status !== 'approved' &&
                  selected.status !== 'rejected' && (
                    <div className="border-t pt-4">
                      <Button
                        className="w-full bg-violet-600 text-white hover:bg-violet-700"
                        onClick={() => {
                          setDecision(
                            selected.status === 'vetoed' ? 'vetoed' : 'vetoed',
                          );
                          setResolveOpen(true);
                        }}
                      >
                        <Gavel className="mr-2 h-4 w-4" />
                        Resolve / veto claim
                      </Button>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Admin override — your decision is final and is recorded
                        alongside the community tally.
                      </p>
                    </div>
                  )}

                {selected.status === 'resolved' ||
                selected.status === 'approved' ||
                selected.status === 'rejected' ? (
                  <div className="border-t pt-4 text-center text-xs text-muted-foreground">
                    <Clock className="mx-auto mb-1 h-4 w-4" />
                    This claim is closed. No further actions available.
                  </div>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => refreshSelected(selected.id)}
                >
                  <Loader2 className="mr-2 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Resolve dialog */}
      <Sheet open={resolveOpen} onOpenChange={setResolveOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-violet-500" />
              Resolve / veto claim
            </SheetTitle>
            <SheetDescription>
              {selected && (
                <>
                  Claim{' '}
                  <span className="font-mono text-foreground">
                    {selected.id.slice(0, 12)}
                  </span>{' '}
                  ·{' '}
                  {tally(selected.votes).support} support /{' '}
                  {tally(selected.votes).reject} reject
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4 px-4 pb-6">
            <div className="space-y-2">
              <Label>Decision</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['approved', 'rejected', 'vetoed'] as ResolutionDecision[]).map(
                  (d) => {
                    const cls = {
                      approved:
                        'border-emerald-500/40 bg-emerald-500/[0.05] text-emerald-600 dark:text-emerald-400',
                      rejected:
                        'border-rose-500/40 bg-rose-500/[0.05] text-rose-600 dark:text-rose-400',
                      vetoed:
                        'border-violet-500/40 bg-violet-500/[0.05] text-violet-600 dark:text-violet-400',
                    }[d];
                    const Icon = {
                      approved: CheckCircle2,
                      rejected: XCircle,
                      vetoed: Ban,
                    }[d];
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDecision(d)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors ${
                          decision === d
                            ? cls
                            : 'border-border bg-card hover:bg-muted/40'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="capitalize">{d}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="resolve-notes">Notes (optional, audited)</Label>
              <Textarea
                id="resolve-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Explain the override (e.g. sanctions screening flagged the customer despite community approval)"
                rows={4}
                maxLength={5000}
              />
            </div>

            <Button
              className="w-full bg-violet-600 text-white hover:bg-violet-700"
              onClick={confirmResolve}
              disabled={resolving}
            >
              {resolving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Gavel className="mr-2 h-4 w-4" />
              )}
              Confirm {decision}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
