'use client';

import * as React from 'react';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Ban,
  Box,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  History,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  LIFECYCLE_FLOW,
  STATUS_META,
  categorySpec,
} from '@/lib/extension-catalog';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

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
  activeInstallCount: number;
  rating: number;
  reviewCount: number;
  featured: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ManagerStats {
  inReview: number;
  published: number;
  suspended: number;
  deprecated: number;
  archived: number;
  featured: number;
  totalInstalls: number;
  total: number;
}

interface ManagerProps {
  extensions: AdminExtension[];
  inReview: AdminExtension[];
  stats: ManagerStats;
  isAdmin: boolean;
}

interface AdminReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface AdminInstall {
  id: string;
  merchantId: string;
  merchantName: string;
  status: string;
  installedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

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

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] font-medium ${meta.tone}`}
    >
      {meta.label}
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

async function apiCall<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!res.ok) {
      return { ok: false, data, error: data?.error ?? `Request failed (${res.status})` };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle timeline (used in the detail sheet)
// ───────────────────────────────────────────────────────────────────────────

function LifecycleTimeline({ status }: { status: string }) {
  const currentIndex = LIFECYCLE_FLOW.indexOf(status as (typeof LIFECYCLE_FLOW)[number]);
  const reachedIndex = currentIndex === -1 ? LIFECYCLE_FLOW.length : currentIndex;

  return (
    <ol className="relative ml-2 space-y-3 border-l border-border pl-4">
      {LIFECYCLE_FLOW.map((s, i) => {
        const meta = STATUS_META[s];
        const isCurrent = s === status;
        const isPast = i < reachedIndex;
        const isFuture = i > reachedIndex;
        return (
          <li key={s} className="relative">
            <span
              className={`absolute -left-[21px] mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 ${
                isCurrent
                  ? 'border-emerald-500 bg-emerald-500'
                  : isPast
                    ? 'border-emerald-500/60 bg-emerald-500/30'
                    : 'border-border bg-background'
              }`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-sm font-medium ${
                  isFuture ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                {meta.label}
              </span>
              {isCurrent && (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400"
                >
                  Current
                </Badge>
              )}
              {isPast && (
                <Badge variant="outline" className="text-[9px]">
                  Completed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </li>
        );
      })}
      {/* Side states */}
      {!LIFECYCLE_FLOW.includes(status as (typeof LIFECYCLE_FLOW)[number]) && (
        <li className="relative">
          <span className="absolute -left-[21px] mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-rose-500 bg-rose-500" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {STATUS_META[status]?.label ?? status}
            </span>
            <Badge
              variant="secondary"
              className="bg-rose-500/15 text-[9px] text-rose-600 dark:text-rose-400"
            >
              Current (side-state)
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {STATUS_META[status]?.description ?? ''}
          </p>
        </li>
      )}
    </ol>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Notes dialog (used for reject / suspend / deprecate / archive / delete)
// ───────────────────────────────────────────────────────────────────────────

function NotesDialog({
  trigger,
  title,
  description,
  cta,
  ctaVariant = 'default',
  ctaIcon: CtaIcon,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  ctaVariant?: 'default' | 'destructive';
  ctaIcon: React.ComponentType<{ className?: string }>;
  onConfirm: (notes: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  async function handle() {
    setSubmitting(true);
    try {
      await onConfirm(notes.trim());
      setOpen(false);
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            placeholder="Add context for the developer / audit log…"
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
            variant={ctaVariant}
            onClick={handle}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CtaIcon className="mr-2 h-4 w-4" />
            )}
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle action button (used for state transitions)
// ───────────────────────────────────────────────────────────────────────────

function LifecycleButton({
  label,
  icon: Icon,
  onClick,
  loading,
  variant = 'outline',
  className = '',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => Promise<void>;
  loading?: boolean;
  variant?: 'default' | 'outline' | 'destructive';
  className?: string;
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={loading}
      className={`h-8 ${className}`}
    >
      {loading ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="mr-1.5 h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Review-card (Marketplace Review tab)
// ───────────────────────────────────────────────────────────────────────────

function ReviewCard({
  ext,
  onDone,
  onOpenDetail,
}: {
  ext: AdminExtension;
  onDone: () => void;
  onOpenDetail: (ext: AdminExtension) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(
    action: string,
    url: string,
    options?: RequestInit,
  ) {
    setBusy(action);
    const { ok, error } = await apiCall(url, options);
    setBusy(null);
    if (!ok) {
      toast.error(error ?? `${action} failed`);
      return;
    }
    toast.success(`${action} succeeded`);
    onDone();
  }

  const spec = categorySpec(ext.category);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex min-w-0 cursor-pointer items-start gap-3"
            onClick={() => onOpenDetail(ext)}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${spec.tone}`}
            >
              <Box className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{ext.name}</CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge status={ext.status} />
                <Badge variant="outline" className={`text-[10px] ${spec.tone}`}>
                  {spec.label}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  v{ext.version}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <CardDescription className="flex-1 text-xs leading-relaxed line-clamp-3">
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

        {ext.reviewNotes &&
          (ext.status === 'rejected' || ext.status === 'suspended') && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs">
              <div className="font-semibold text-rose-600 dark:text-rose-400">
                {ext.status === 'rejected' ? 'Rejection reason' : 'Suspension reason'}
              </div>
              <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
            </div>
          )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpenDetail(ext)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" /> Details
          </Button>

          {ext.status === 'submitted' && (
            <>
              <LifecycleButton
                label="Static analysis"
                icon={ClipboardCheck}
                loading={busy === 'static-analysis'}
                onClick={() =>
                  run(
                    'static-analysis',
                    `/api/admin/extensions/${ext.id}/static-analysis`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                  )
                }
              />
              <LifecycleButton
                label="Security scan"
                icon={ShieldAlert}
                loading={busy === 'scan'}
                onClick={() =>
                  run(
                    'scan',
                    `/api/admin/extensions/${ext.id}/scan`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                  )
                }
              />
            </>
          )}

          {(ext.status === 'submitted' ||
            ext.status === 'static_analysis' ||
            ext.status === 'security_scan' ||
            ext.status === 'review' ||
            ext.status === 'approved') && (
            <LifecycleButton
              label="Approve & publish"
              icon={CheckCircle2}
              variant="default"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              loading={busy === 'approve'}
              onClick={() =>
                run(
                  'approve',
                  `/api/admin/extensions/${ext.id}/approve`,
                  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                )
              }
            />
          )}

          {(ext.status === 'submitted' ||
            ext.status === 'static_analysis' ||
            ext.status === 'security_scan' ||
            ext.status === 'review') && (
            <NotesDialog
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                >
                  <Ban className="mr-1.5 h-3.5 w-3.5" /> Reject
                </Button>
              }
              title={`Reject "${ext.name}"?`}
              description="The developer will see your notes and can re-submit after fixing the issues."
              cta="Reject extension"
              ctaVariant="destructive"
              ctaIcon={Ban}
              onConfirm={async (notes) => {
                await run(
                  'reject',
                  `/api/admin/extensions/${ext.id}/reject`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes }),
                  },
                );
              }}
            />
          )}

          {ext.status === 'suspended' && (
            <LifecycleButton
              label="Reinstate"
              icon={RotateCcw}
              loading={busy === 'reinstate'}
              onClick={() =>
                run(
                  'reinstate',
                  `/api/extensions/${ext.id}/publish`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reinstate' }),
                  },
                )
              }
            />
          )}

          {ext.status === 'published' && (
            <NotesDialog
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                >
                  <Ban className="mr-1.5 h-3.5 w-3.5" /> Suspend
                </Button>
              }
              title={`Suspend "${ext.name}"?`}
              description="Suspended extensions disappear from the marketplace immediately. Existing installs keep their config but the extension stops running."
              cta="Suspend extension"
              ctaVariant="destructive"
              ctaIcon={Ban}
              onConfirm={async (notes) => {
                await run(
                  'suspend',
                  `/api/extensions/${ext.id}/publish`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'suspend', notes }),
                  },
                );
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog-row (All Extensions tab)
// ───────────────────────────────────────────────────────────────────────────

function CatalogRow({
  ext,
  onDone,
  onOpenDetail,
}: {
  ext: AdminExtension;
  onDone: () => void;
  onOpenDetail: (ext: AdminExtension) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const spec = categorySpec(ext.category);

  async function run(action: string, url: string, options?: RequestInit) {
    setBusy(action);
    const { ok, error } = await apiCall(url, options);
    setBusy(null);
    if (!ok) {
      toast.error(error ?? `${action} failed`);
      return;
    }
    toast.success(`${action} succeeded`);
    onDone();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${spec.tone}`}
          >
            <Box className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpenDetail(ext)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{ext.name}</span>
              <StatusBadge status={ext.status} />
              {ext.featured && (
                <Badge
                  variant="secondary"
                  className="bg-fuchsia-500/10 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400"
                >
                  <Sparkles className="mr-1 h-2.5 w-2.5" /> Featured
                </Badge>
              )}
              <Badge variant="outline" className={`text-[10px] ${spec.tone}`}>
                {spec.label}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                v{ext.version}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>by {ext.developer.name}</span>
              <span>·</span>
              <span className="font-mono">{ext.developer.email}</span>
              <span>·</span>
              <span>{ext.installCount.toLocaleString()} installs</span>
              <span>·</span>
              <Stars rating={ext.rating} />
              <span>({ext.reviewCount})</span>
              <span>·</span>
              <span>updated {fmtDate(ext.updatedAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => onOpenDetail(ext)}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" /> Details
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Lifecycle
                </DropdownMenuLabel>

                {(ext.status === 'submitted' ||
                  ext.status === 'static_analysis' ||
                  ext.status === 'security_scan' ||
                  ext.status === 'review' ||
                  ext.status === 'approved') && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        'approve',
                        `/api/admin/extensions/${ext.id}/approve`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                      )
                    }
                  >
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Approve &amp; publish
                  </DropdownMenuItem>
                )}

                {ext.status === 'submitted' && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          'static-analysis',
                          `/api/admin/extensions/${ext.id}/static-analysis`,
                          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                        )
                      }
                    >
                      <ClipboardCheck className="mr-2 h-3.5 w-3.5" /> Send to static analysis
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          'scan',
                          `/api/admin/extensions/${ext.id}/scan`,
                          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                        )
                      }
                    >
                      <ShieldAlert className="mr-2 h-3.5 w-3.5" /> Send to security scan
                    </DropdownMenuItem>
                  </>
                )}

                {ext.status === 'published' && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        ext.featured ? 'unfeature' : 'feature',
                        `/api/admin/extensions/${ext.id}/feature`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ featured: !ext.featured }),
                        },
                      )
                    }
                  >
                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                    {ext.featured ? 'Unfeature' : 'Feature on marketplace'}
                  </DropdownMenuItem>
                )}

                {(ext.status === 'published' || ext.status === 'suspended') && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        'deprecate',
                        `/api/admin/extensions/${ext.id}/deprecate`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                      )
                    }
                  >
                    <Archive className="mr-2 h-3.5 w-3.5" /> Deprecate
                  </DropdownMenuItem>
                )}

                {ext.status === 'published' && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        'suspend',
                        `/api/extensions/${ext.id}/publish`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'suspend' }),
                        },
                      )
                    }
                  >
                    <Ban className="mr-2 h-3.5 w-3.5" /> Suspend
                  </DropdownMenuItem>
                )}

                {ext.status === 'suspended' && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        'reinstate',
                        `/api/extensions/${ext.id}/publish`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'reinstate' }),
                        },
                      )
                    }
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reinstate
                  </DropdownMenuItem>
                )}

                {ext.status === 'deprecated' && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        'archive',
                        `/api/admin/extensions/${ext.id}/archive`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                      )
                    }
                  >
                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Archive permanently
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  className="text-rose-600 dark:text-rose-400"
                  onClick={() => {
                    if (
                      confirm(
                        `Permanently delete "${ext.name}"? This removes all installs and reviews. This action cannot be undone.`,
                      )
                    ) {
                      run(
                        'delete',
                        `/api/admin/extensions/${ext.id}/delete`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                      );
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete extension
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {busy && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Running {busy}…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Detail sheet (right-side drawer with full extension info)
// ───────────────────────────────────────────────────────────────────────────

function DetailSheet({
  ext,
  open,
  onOpenChange,
}: {
  ext: AdminExtension | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [reviews, setReviews] = React.useState<AdminReview[]>([]);
  const [installs, setInstalls] = React.useState<AdminInstall[]>([]);
  const [loadingExtras, setLoadingExtras] = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'lifecycle' | 'reviews' | 'installs'>('overview');

  React.useEffect(() => {
    if (!open || !ext) return;
    let cancelled = false;
    setLoadingExtras(true);
    Promise.all([
      fetch(`/api/admin/extensions/${ext.id}/reviews`).then((r) => r.json()),
      fetch(`/api/admin/extensions/${ext.id}/installs`).then((r) => r.json()),
    ])
      .then(([revData, insData]) => {
        if (cancelled) return;
        if (revData?.ok) setReviews(revData.reviews ?? []);
        if (insData?.ok) setInstalls(insData.installs ?? []);
      })
      .catch(() => {
        // ignore — extras are best-effort
      })
      .finally(() => {
        if (!cancelled) setLoadingExtras(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ext]);

  if (!ext) return null;
  const spec = categorySpec(ext.category);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <SheetHeader className="space-y-2 border-b pb-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${spec.tone}`}
            >
              <Box className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg">{ext.name}</SheetTitle>
              <SheetDescription className="mt-0.5">
                <code className="font-mono text-xs">{ext.slug}</code> · v{ext.version} ·{' '}
                by {ext.developer.name}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={ext.status} />
                {ext.featured && (
                  <Badge
                    variant="secondary"
                    className="bg-fuchsia-500/10 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400"
                  >
                    <Sparkles className="mr-1 h-2.5 w-2.5" /> Featured
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[10px] ${spec.tone}`}>
                  {spec.label}
                </Badge>
                <Stars rating={ext.rating} />
                <span className="text-[11px] text-muted-foreground">
                  ({ext.reviewCount} reviews · {ext.installCount.toLocaleString()} installs)
                </span>
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b px-4 py-2">
          {(['overview', 'lifecycle', 'reviews', 'installs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {tab === 'overview' && (
              <>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </h4>
                  <p className="mt-1 text-sm leading-relaxed">{ext.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Pricing
                    </div>
                    <div className="mt-1 text-sm capitalize">
                      {ext.pricing}
                      {ext.pricing !== 'free' && ` · $${ext.price.toFixed(2)}/mo`}
                    </div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Submitted
                    </div>
                    <div className="mt-1 text-sm">{fmtDate(ext.submittedAt)}</div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Published
                    </div>
                    <div className="mt-1 text-sm">{fmtDate(ext.publishedAt)}</div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Active installs
                    </div>
                    <div className="mt-1 text-sm tabular-nums">
                      {ext.activeInstallCount}
                    </div>
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
                            <Badge variant="outline" className="font-mono text-[10px]">
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
                      Review notes
                    </div>
                    <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
                  </div>
                )}
              </>
            )}

            {tab === 'lifecycle' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Lifecycle timeline
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The canonical progression from draft to published. Side-states
                    (rejected, suspended, deprecated, archived) appear at the
                    bottom when active.
                  </p>
                </div>
                <LifecycleTimeline status={ext.status} />
                <div className="rounded-md border bg-card/50 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Current status</span>
                    <StatusBadge status={ext.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Reviewed at</span>
                    <span>{fmtDateTime(ext.reviewedAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Reviewed by</span>
                    <span className="font-mono text-[11px]">
                      {ext.reviewedBy ?? '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Created at</span>
                    <span>{fmtDateTime(ext.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Updated at</span>
                    <span>{fmtDateTime(ext.updatedAt)}</span>
                  </div>
                </div>
              </div>
            )}

            {tab === 'reviews' && (
              <div className="space-y-2">
                {loadingExtras ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-card/50 p-6 text-center">
                    <p className="text-sm font-medium">No reviews yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This extension has not received any merchant reviews.
                    </p>
                  </div>
                ) : (
                  reviews.map((r) => (
                    <div key={r.id} className="rounded-md border bg-card/50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {r.user?.name ?? 'Anonymous'}
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            {r.user?.email ?? ''}
                          </span>
                        </div>
                        <Stars rating={r.rating} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {r.comment}
                      </p>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {fmtDateTime(r.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'installs' && (
              <div className="space-y-2">
                {loadingExtras ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : installs.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-card/50 p-6 text-center">
                    <p className="text-sm font-medium">No installs</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No merchant has installed this extension yet.
                    </p>
                  </div>
                ) : (
                  installs.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center justify-between rounded-md border bg-card/50 p-3 text-xs"
                    >
                      <div>
                        <div className="font-medium">{i.merchantName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {i.merchantId}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {i.status}
                        </Badge>
                        <div className="text-muted-foreground">
                          {fmtDate(i.installedAt)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Stats strip
// ───────────────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone = 'text-foreground',
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Main manager component
// ───────────────────────────────────────────────────────────────────────────

export function AdminExtensionsManager({
  extensions,
  inReview,
  stats,
  isAdmin,
}: ManagerProps) {
  const [detail, setDetail] = React.useState<AdminExtension | null>(null);
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const reload = React.useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          You need admin privileges to manage extensions.
        </CardContent>
      </Card>
    );
  }

  const filteredAll = extensions.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !e.name.toLowerCase().includes(q) &&
        !e.slug.toLowerCase().includes(q) &&
        !e.developer.email.toLowerCase().includes(q) &&
        !e.developer.name.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const filteredReview = inReview.filter((e) => {
    if (query) {
      const q = query.toLowerCase();
      if (
        !e.name.toLowerCase().includes(q) &&
        !e.slug.toLowerCase().includes(q) &&
        !e.developer.email.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile
          label="In review"
          value={stats.inReview}
          tone="text-amber-600 dark:text-amber-400"
        />
        <StatTile
          label="Published"
          value={stats.published}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <StatTile
          label="Suspended"
          value={stats.suspended}
          tone="text-rose-600 dark:text-rose-400"
        />
        <StatTile
          label="Deprecated"
          value={stats.deprecated}
          tone="text-amber-600 dark:text-amber-400"
        />
        <StatTile
          label="Archived"
          value={stats.archived}
          tone="text-slate-600 dark:text-slate-400"
        />
        <StatTile
          label="Featured"
          value={stats.featured}
          tone="text-fuchsia-600 dark:text-fuchsia-400"
        />
        <StatTile
          label="Total installs"
          value={stats.totalInstalls}
          tone="text-cyan-600 dark:text-cyan-400"
        />
        <StatTile label="Total" value={stats.total} />
      </div>

      <Tabs defaultValue="review" className="space-y-4">
        <TabsList>
          <TabsTrigger value="review" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            Marketplace Review
            <Badge
              variant="secondary"
              className="ml-1 bg-amber-500/15 text-[9px] text-amber-600 dark:text-amber-400"
            >
              {inReview.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="catalog" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            All Extensions
            <Badge variant="secondary" className="ml-1 text-[9px]">
              {extensions.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Search + filter (shared) */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, slug or developer email…"
            className="h-9 sm:max-w-md"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-xs"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sandbox">Sandbox</option>
            <option value="submitted">Submitted</option>
            <option value="static_analysis">Static analysis</option>
            <option value="security_scan">Security scan</option>
            <option value="review">Under review</option>
            <option value="approved">Approved</option>
            <option value="published">Published</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
            <option value="deprecated">Deprecated</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <TabsContent value="review" className="space-y-3">
          {filteredReview.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card/50 p-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-3 text-sm font-medium">Queue is empty</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No extensions are waiting for review.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredReview.map((ext) => (
                <ReviewCard
                  key={ext.id}
                  ext={ext}
                  onDone={reload}
                  onOpenDetail={(e) => setDetail(e)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="catalog" className="space-y-3">
          {filteredAll.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card/50 p-10 text-center">
              <Box className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No extensions match</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different status filter or search term.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 h-8"
                onClick={() => {
                  setStatusFilter('all');
                  setQuery('');
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAll.map((ext) => (
                <CatalogRow
                  key={ext.id}
                  ext={ext}
                  onDone={reload}
                  onOpenDetail={(e) => setDetail(e)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <DetailSheet
        ext={detail}
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
      />
    </div>
  );
}
