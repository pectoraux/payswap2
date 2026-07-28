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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ShieldAlert,
  Plus,
  Search,
  Loader2,
  Inbox,
  FileText,
  Link2,
  MessageSquare,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  Gavel,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types (mirrored from the admin claims-manager) ─────────────────────────

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

export interface EvidenceDTO {
  id: string;
  claimId: string;
  type: EvidenceType;
  description: string;
  reference?: string;
  submittedByEmail?: string;
  submittedAt: string;
}

export interface VoteDTO {
  id: string;
  claimId: string;
  vote: VoteChoice;
  comment?: string;
  voterEmail?: string;
  votedAt: string;
}

export interface ResolutionDTO {
  decision: 'approved' | 'rejected' | 'vetoed';
  notes?: string;
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
  claimantEmail?: string;
  merchantId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  resolution?: ResolutionDTO | null;
  evidence: EvidenceDTO[];
  votes: VoteDTO[];
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

const TYPE_OPTIONS: Array<{ value: ClaimType; label: string }> = [
  { value: 'unauthorized_transaction', label: 'Unauthorized transaction' },
  { value: 'duplicate_charge', label: 'Duplicate charge' },
  { value: 'product_not_received', label: 'Product not received' },
  { value: 'product_not_as_described', label: 'Product not as described' },
  { value: 'incorrect_amount', label: 'Incorrect amount' },
  { value: 'refund_not_processed', label: 'Refund not processed' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'settlement_failure', label: 'Settlement failure' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABEL: Record<ClaimType, string> = TYPE_OPTIONS.reduce(
  (acc, t) => {
    acc[t.value] = t.label;
    return acc;
  },
  {} as Record<ClaimType, string>,
);

const EVIDENCE_OPTIONS: Array<{ value: EvidenceType; label: string }> = [
  { value: 'text', label: 'Text note' },
  { value: 'file_reference', label: 'File reference' },
  { value: 'screenshot', label: 'Screenshot URL' },
  { value: 'transaction_log', label: 'Transaction log' },
  { value: 'communication', label: 'Communication (email / chat)' },
  { value: 'other', label: 'Other' },
];

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

export interface MerchantClaimsManagerProps {
  initial: ClaimDTO[];
}

export function MerchantClaimsManager({ initial }: MerchantClaimsManagerProps) {
  const [claims, setClaims] = useState<ClaimDTO[]>(initial);
  const [filterStatus, setFilterStatus] = useState<ClaimStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newTxnId, setNewTxnId] = useState('');
  const [newType, setNewType] = useState<ClaimType>('unauthorized_transaction');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState<ClaimDTO | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evType, setEvType] = useState<EvidenceType>('text');
  const [evDescription, setEvDescription] = useState('');
  const [evReference, setEvReference] = useState('');
  const [submittingEvidence, setSubmittingEvidence] = useState(false);

  const [voteBusy, setVoteBusy] = useState<VoteChoice | null>(null);

  const filtered = useMemo(() => {
    let rows = claims;
    if (filterStatus !== 'all') rows = rows.filter((c) => c.status === filterStatus);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          c.transactionId.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [claims, filterStatus, query]);

  async function createClaim() {
    if (!newTxnId.trim()) {
      toast.error('Transaction ID is required');
      return;
    }
    if (!newDescription.trim()) {
      toast.error('Description is required');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: newTxnId.trim(),
          type: newType,
          description: newDescription.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Create failed (${res.status})`);
      }
      toast.success('Claim created');
      setClaims((prev) => [data.claim, ...prev]);
      setCreateOpen(false);
      setNewTxnId('');
      setNewType('unauthorized_transaction');
      setNewDescription('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function refreshSelected(id: string) {
    try {
      const res = await fetch(`/api/claims/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setSelected(data.claim);
        setClaims((prev) =>
          prev.map((c) => (c.id === data.claim.id ? data.claim : c)),
        );
      }
    } catch {
      // ignore
    }
  }

  async function submitEvidence() {
    if (!selected) return;
    if (!evDescription.trim()) {
      toast.error('Description is required');
      return;
    }
    setSubmittingEvidence(true);
    try {
      const res = await fetch(
        `/api/claims/${encodeURIComponent(selected.id)}/evidence`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: evType,
            description: evDescription.trim(),
            reference: evReference.trim() || undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Submit failed (${res.status})`);
      }
      toast.success('Evidence submitted');
      await refreshSelected(selected.id);
      setEvidenceOpen(false);
      setEvType('text');
      setEvDescription('');
      setEvReference('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmittingEvidence(false);
    }
  }

  async function castVote(vote: VoteChoice) {
    if (!selected) return;
    setVoteBusy(vote);
    try {
      const res = await fetch(
        `/api/claims/${encodeURIComponent(selected.id)}/vote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Vote failed (${res.status})`);
      }
      toast.success(`Voted ${vote}`);
      await refreshSelected(selected.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setVoteBusy(null);
    }
  }

  const openCount = claims.filter((c) => c.status === 'open').length;
  const reviewCount = claims.filter((c) => c.status === 'under_review').length;
  const resolvedCount = claims.filter(
    (c) =>
      c.status === 'approved' ||
      c.status === 'rejected' ||
      c.status === 'vetoed' ||
      c.status === 'resolved',
  ).length;

  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open
              </span>
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {openCount}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Newly created, awaiting review
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Under review
              </span>
              <MessageSquare className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {reviewCount}
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
                Resolved
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {resolvedCount}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Closed / vetoed / resolved
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Claims table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Your claims</CardTitle>
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
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New claim
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Inbox className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-medium">No claims yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Dispute a transaction by creating a claim. The PaySwap community
                and admins will review the evidence.
              </p>
              <Button
                className="mt-4 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create your first claim
              </Button>
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Type</TableHead>
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
                            onClick={() => setSelected(c)}
                          >
                            Open
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
                  <span className="font-mono text-base">
                    {selected.id.slice(0, 16)}
                  </span>
                </SheetTitle>
                <SheetDescription>
                  Dispute on transaction{' '}
                  <span className="font-mono text-foreground">
                    {selected.transactionId}
                  </span>{' '}
                  · created {fmtDate(selected.createdAt)}
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

                {/* Resolution banner */}
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
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Evidence ({selected.evidence.length})
                    </div>
                    {selected.status !== 'resolved' &&
                      selected.status !== 'vetoed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEvidenceOpen(true)}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add evidence
                        </Button>
                      )}
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
                            <p className="mt-1.5 text-foreground">
                              {e.description}
                            </p>
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
                              · {fmtDate(v.votedAt)} · {v.voterEmail ?? '—'}
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

                {/* Cast vote */}
                {selected.status !== 'resolved' &&
                  selected.status !== 'vetoed' && (
                    <div className="border-t pt-4">
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Cast your vote
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                          onClick={() => castVote('support')}
                          disabled={voteBusy !== null}
                        >
                          {voteBusy === 'support' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ThumbsUp className="mr-2 h-4 w-4" />
                          )}
                          Support
                        </Button>
                        <Button
                          variant="outline"
                          className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                          onClick={() => castVote('reject')}
                          disabled={voteBusy !== null}
                        >
                          {voteBusy === 'reject' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ThumbsDown className="mr-2 h-4 w-4" />
                          )}
                          Reject
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        You can change your vote at any time before the claim is
                        resolved.
                      </p>
                    </div>
                  )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create claim dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Dispute a transaction
            </DialogTitle>
            <DialogDescription>
              Create a claim against a transaction. The PaySwap community and
              admins will review the evidence and vote.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-txn">
                Transaction ID <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="claim-txn"
                value={newTxnId}
                onChange={(e) => setNewTxnId(e.target.value)}
                placeholder="e.g. pay_abc123"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-type">
                Type <span className="text-rose-500">*</span>
              </Label>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as ClaimType)}
              >
                <SelectTrigger id="claim-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-desc">
                Description <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                id="claim-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe the dispute. What happened? What outcome are you requesting?"
                rows={5}
                maxLength={5000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={createClaim}
              disabled={creating || !newTxnId.trim() || !newDescription.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit evidence dialog */}
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-500" />
              Submit evidence
            </DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  Claim{' '}
                  <span className="font-mono text-foreground">
                    {selected.id.slice(0, 12)}
                  </span>{' '}
                  · {selected.transactionId}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-type">
                Type <span className="text-rose-500">*</span>
              </Label>
              <Select
                value={evType}
                onValueChange={(v) => setEvType(v as EvidenceType)}
              >
                <SelectTrigger id="ev-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVIDENCE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-desc">
                Description <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                id="ev-desc"
                value={evDescription}
                onChange={(e) => setEvDescription(e.target.value)}
                placeholder="What does this evidence show?"
                rows={4}
                maxLength={5000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-ref">
                Reference{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="ev-ref"
                value={evReference}
                onChange={(e) => setEvReference(e.target.value)}
                placeholder="File URL, hash, log id, etc."
                maxLength={2048}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEvidenceOpen(false)}
              disabled={submittingEvidence}
            >
              Cancel
            </Button>
            <Button
              onClick={submitEvidence}
              disabled={submittingEvidence || !evDescription.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {submittingEvidence ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Submit evidence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
