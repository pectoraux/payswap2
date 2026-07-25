'use client';

import * as React from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  RotateCcw,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export interface AdminDeveloper {
  id: string;
  name: string;
  email: string;
}

export interface AdminExtension {
  id: string;
  slug: string;
  name: string;
  description: string;
  developerId: string;
  developer: AdminDeveloper;
  category: string;
  iconUrl: string | null;
  version: string;
  status: string;
  permissions: string[];
  pricing: string;
  price: number;
  config: Record<string, unknown> | null;
  changelog: Array<{ version: string; date: string; changes: string }>;
  installCount: number;
  rating: number;
  reviewCount: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ManagerStats {
  inReview: number;
  published: number;
  suspended: number;
  totalInstalls: number;
}

interface ManagerProps {
  extensions: AdminExtension[];
  inReview: AdminExtension[];
  published: AdminExtension[];
  suspended: AdminExtension[];
  stats: ManagerStats;
  isAdmin: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  review: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  published: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  suspended: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
  suspended: 'Suspended',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] font-medium capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      <Star className="h-3 w-3 fill-current" />
      <span className="text-xs font-medium tabular-nums">
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

/**
 * Post an action to the admin publish endpoint. Refreshes the page on
 * success so the server-rendered list re-syncs.
 */
async function postAction(
  id: string,
  action: 'approve' | 'reject' | 'review' | 'suspend' | 'reinstate',
  notes?: string,
): Promise<void> {
  const res = await fetch(`/api/extensions/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, notes: notes ?? undefined }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Action failed');
  }
}

/**
 * Reject dialog: asks for a reason before flipping status to rejected.
 */
function RejectDialog({
  ext,
  onDone,
}: {
  ext: AdminExtension;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  async function handle() {
    if (!notes.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    setSubmitting(true);
    try {
      await postAction(ext.id, 'reject', notes.trim());
      toast.success('Extension rejected');
      setOpen(false);
      setNotes('');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
          <Ban className="mr-1.5 h-3.5 w-3.5" /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject “{ext.name}”?</DialogTitle>
          <DialogDescription>
            Provide a clear reason — the developer will see this feedback and
            can re-submit after fixing the issues.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-notes">Reason</Label>
          <Textarea
            id="reject-notes"
            placeholder="e.g. Missing required permissions documentation…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-24"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handle}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Ban className="mr-2 h-4 w-4" />
            )}
            Reject extension
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Suspend dialog: asks for a reason before suspending a published extension.
 */
function SuspendDialog({
  ext,
  onDone,
}: {
  ext: AdminExtension;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  async function handle() {
    if (!notes.trim()) {
      toast.error('Please provide a suspension reason');
      return;
    }
    setSubmitting(true);
    try {
      await postAction(ext.id, 'suspend', notes.trim());
      toast.success('Extension suspended');
      setOpen(false);
      setNotes('');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to suspend');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
        >
          <Ban className="mr-1.5 h-3.5 w-3.5" /> Suspend
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suspend “{ext.name}”?</DialogTitle>
          <DialogDescription>
            Suspended extensions disappear from the marketplace immediately.
            Merchants who already installed it keep their config but the
            extension will be marked inactive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="suspend-notes">Reason</Label>
          <Textarea
            id="suspend-notes"
            placeholder="e.g. Policy violation — abusive data access…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-24"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={handle} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Ban className="mr-2 h-4 w-4" />
            )}
            Suspend extension
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Details dialog: shows full extension metadata (permissions, config schema,
 * changelog, developer info) so admins can make an informed review decision.
 */
function DetailsDialog({ ext }: { ext: AdminExtension }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Eye className="mr-1.5 h-3.5 w-3.5" /> Details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ext.name}</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">{ext.slug}</code> · v
            {ext.version} · by {ext.developer.name} ({ext.developer.email})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </h4>
            <p className="mt-1 text-sm">{ext.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </h4>
              <div className="mt-1 text-sm capitalize">{ext.category}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pricing
              </h4>
              <div className="mt-1 text-sm capitalize">
                {ext.pricing}
                {ext.pricing !== 'free' && ` · $${ext.price.toFixed(2)}/mo`}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Submitted
              </h4>
              <div className="mt-1 text-sm">{fmtDate(ext.submittedAt)}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Installs
              </h4>
              <div className="mt-1 text-sm tabular-nums">{ext.installCount}</div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Permissions
            </h4>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ext.permissions.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  None declared
                </span>
              ) : (
                ext.permissions.map((p) => (
                  <Badge
                    key={p}
                    variant="secondary"
                    className="bg-teal-500/10 text-[10px] font-medium text-teal-600 dark:text-teal-400"
                  >
                    {p.replace(/_/g, ' ')}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Configuration schema
            </h4>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-card/50 p-3 text-[11px] leading-relaxed">
              <code className="font-mono">
                {ext.config
                  ? JSON.stringify(ext.config, null, 2)
                  : 'No configuration schema declared.'}
              </code>
            </pre>
          </div>

          {ext.changelog.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Changelog
              </h4>
              <ul className="mt-1 space-y-1.5">
                {ext.changelog.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-md border bg-card/50 p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        v{c.version}
                      </Badge>
                      <span className="text-muted-foreground">
                        {fmtDate(c.date)}
                      </span>
                    </div>
                    <p className="mt-1 text-foreground">{c.changes}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ext.reviewNotes && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <div className="font-semibold text-amber-600 dark:text-amber-400">
                Previous review notes
              </div>
              <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  loading,
  variant = 'default',
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'default' | 'outline';
  className?: string;
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={disabled || loading}
      className={`h-8 ${className}`}
    >
      {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      {children}
    </Button>
  );
}

/**
 * Review-row card with admin actions: approve, put under review, reject,
 * view details. Suspended rows show a reinstate button.
 */
function ReviewCard({
  ext,
  onDone,
}: {
  ext: AdminExtension;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(
    action: 'approve' | 'review' | 'reinstate',
    label: string,
  ) {
    setBusy(label);
    try {
      await postAction(ext.id, action);
      toast.success(
        action === 'approve'
          ? 'Extension published'
          : action === 'review'
            ? 'Moved to review'
            : 'Extension reinstated',
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{ext.name}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={ext.status} />
              <Badge
                variant="outline"
                className="text-[10px] font-medium capitalize"
              >
                {ext.category}
              </Badge>
              <Badge
                variant="outline"
                className="font-mono text-[10px] font-medium"
              >
                v{ext.version}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <CardDescription className="flex-1 text-xs leading-relaxed">
          {ext.description}
        </CardDescription>

        <div className="rounded-md border bg-card/50 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Developer</span>
            <span className="font-medium">{ext.developer.name}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-mono text-[11px]">{ext.developer.email}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Submitted</span>
            <span>{fmtDate(ext.submittedAt)}</span>
          </div>
        </div>

        {ext.permissions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ext.permissions.map((p) => (
              <Badge
                key={p}
                variant="secondary"
                className="bg-teal-500/10 text-[10px] font-medium text-teal-600 dark:text-teal-400"
              >
                {p.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}

        {ext.reviewNotes && ext.status === 'rejected' && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs">
            <div className="font-semibold text-rose-600 dark:text-rose-400">
              Rejection reason
            </div>
            <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
          </div>
        )}
        {ext.reviewNotes && ext.status === 'suspended' && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs">
            <div className="font-semibold text-rose-600 dark:text-rose-400">
              Suspension reason
            </div>
            <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <DetailsDialog ext={ext} />

          {ext.status === 'submitted' && (
            <ActionButton
              variant="outline"
              onClick={() => run('review', 'review')}
              loading={busy === 'review'}
            >
              <AlertCircle className="mr-1.5 h-3.5 w-3.5" /> Under review
            </ActionButton>
          )}

          {['submitted', 'review', 'approved'].includes(ext.status) && (
            <ActionButton
              onClick={() => run('approve', 'approve')}
              loading={busy === 'approve'}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve &amp; publish
            </ActionButton>
          )}

          {['submitted', 'review'].includes(ext.status) && (
            <RejectDialog ext={ext} onDone={onDone} />
          )}

          {ext.status === 'suspended' && (
            <ActionButton
              variant="outline"
              onClick={() => run('reinstate', 'reinstate')}
              loading={busy === 'reinstate'}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reinstate
            </ActionButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Compact published-row card with suspend action.
 */
function PublishedCard({
  ext,
  onDone,
}: {
  ext: AdminExtension;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-sm">{ext.name}</CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="capitalize">{ext.category}</span>
                <span>·</span>
                <span className="font-mono">v{ext.version}</span>
                <span>·</span>
                <span>{ext.developer.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  {ext.installCount}
                </div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  installs
                </div>
              </div>
              <Stars rating={ext.rating} />
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  {open ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">{ext.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {ext.permissions.map((p) => (
                <Badge
                  key={p}
                  variant="secondary"
                  className="bg-teal-500/10 text-[10px] font-medium text-teal-600 dark:text-teal-400"
                >
                  {p.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <DetailsDialog ext={ext} />
              <SuspendDialog ext={ext} onDone={onDone} />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function AdminExtensionsManager({
  extensions,
  inReview,
  published,
  suspended,
  stats,
  isAdmin,
}: ManagerProps) {
  const reload = React.useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          You need admin privileges to review extensions.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            In review
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.inReview}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Published
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.published}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Suspended
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
            {stats.suspended}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Total installs
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums">
            {stats.totalInstalls}
          </div>
        </div>
      </div>

      {/* In-review queue */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Review queue</h2>
          <Badge
            variant="secondary"
            className="bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400"
          >
            {inReview.length + suspended.length}
          </Badge>
        </div>
        {inReview.length === 0 && suspended.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card/50 p-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="mt-3 text-sm font-medium">Queue is empty</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No extensions are waiting for review.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...inReview, ...suspended].map((ext) => (
              <ReviewCard key={ext.id} ext={ext} onDone={reload} />
            ))}
          </div>
        )}
      </div>

      {/* Published extensions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Published extensions</h2>
          <Badge
            variant="secondary"
            className="bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
          >
            {published.length}
          </Badge>
        </div>
        {published.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card/50 p-10 text-center">
            <p className="text-sm font-medium">Nothing published yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Approve submissions above to populate the marketplace.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {published.map((ext) => (
              <PublishedCard key={ext.id} ext={ext} onDone={reload} />
            ))}
          </div>
        )}
      </div>

      {/* Draft / rejected extensions — read-only, no actions */}
      {extensions.some((e) => e.status === 'draft' || e.status === 'rejected') && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Drafts &amp; rejected</h2>
            <Badge variant="secondary" className="text-[10px]">
              {extensions.filter((e) => e.status === 'draft' || e.status === 'rejected').length}
            </Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {extensions
              .filter((e) => e.status === 'draft' || e.status === 'rejected')
              .map((ext) => (
                <Card key={ext.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="truncate text-sm">{ext.name}</CardTitle>
                      <StatusBadge status={ext.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    <p className="line-clamp-2">{ext.description}</p>
                    <div className="mt-2">
                      by {ext.developer.name} · {fmtDate(ext.updatedAt)}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
