'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
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
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  categoryMeta,
  type PublicPlugin,
  type VerificationResult,
} from '@/marketplace';

interface Stats {
  pending: number;
  published: number;
  rejected: number;
  suspended: number;
  featured: number;
  total: number;
}

interface Props {
  pending: PublicPlugin[];
  all: PublicPlugin[];
  stats: Stats;
  isAdmin: boolean;
}

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  static_analysis: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  security_scan: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  review: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  published: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  suspended: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  deprecated: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  archived: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
};

export function MarketplaceReviewClient({ pending, all, stats, isAdmin }: Props) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<PublicPlugin | null>(null);
  const [tab, setTab] = React.useState<'pending' | 'all' | 'published'>('pending');
  const [verifyTarget, setVerifyTarget] = React.useState<PublicPlugin | null>(null);
  const [verifyResult, setVerifyResult] = React.useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectNotes, setRejectNotes] = React.useState('');
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [approvePublish, setApprovePublish] = React.useState(true);

  const list = tab === 'pending' ? pending : tab === 'published' ? all.filter((p) => p.status === 'published') : all;

  const onVerify = async (plugin: PublicPlugin) => {
    setVerifying(true);
    setVerifyTarget(plugin);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/admin/marketplace/${plugin.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Verify failed');
        return;
      }
      setVerifyResult(json.verification);
      toast.success(`Verification: ${json.verification.status} (score ${json.verification.score})`);
      router.refresh();
    } catch {
      toast.error('Verify failed');
    } finally {
      setVerifying(false);
    }
  };

  const onApprove = async (plugin: PublicPlugin, publish: boolean, notes?: string) => {
    try {
      const res = await fetch(`/api/admin/marketplace/${plugin.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish, notes }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Approve failed');
        return;
      }
      toast.success(publish ? 'Approved & published' : 'Approved');
      setApproveOpen(false);
      setSelected(null);
      router.refresh();
    } catch {
      toast.error('Approve failed');
    }
  };

  const onReject = async (plugin: PublicPlugin, notes: string) => {
    try {
      const res = await fetch(`/api/admin/marketplace/${plugin.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Reject failed');
        return;
      }
      toast.success('Rejected');
      setRejectOpen(false);
      setRejectNotes('');
      setSelected(null);
      router.refresh();
    } catch {
      toast.error('Reject failed');
    }
  };

  const onFeature = async (plugin: PublicPlugin, value: boolean) => {
    try {
      const res = await fetch(`/api/admin/marketplace/${plugin.id}/feature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured: value }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Feature toggle failed');
        return;
      }
      toast.success(value ? 'Featured' : 'Unfeatured');
      router.refresh();
    } catch {
      toast.error('Feature toggle failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Pending" value={stats.pending} icon={Clock} tone="text-amber-600 dark:text-amber-400" />
        <StatTile label="Published" value={stats.published} icon={CheckCircle2} tone="text-emerald-600 dark:text-emerald-400" />
        <StatTile label="Rejected" value={stats.rejected} icon={XCircle} tone="text-rose-600 dark:text-rose-400" />
        <StatTile label="Suspended" value={stats.suspended} icon={AlertCircle} tone="text-rose-600 dark:text-rose-400" />
        <StatTile label="Featured" value={stats.featured} icon={Sparkles} tone="text-amber-600 dark:text-amber-400" />
        <StatTile label="Total" value={stats.total} icon={ShieldCheck} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending review ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="published">
            Published ({stats.published})
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({stats.total})
          </TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm text-muted-foreground">
                {tab === 'pending'
                  ? 'No plugins pending review.'
                  : tab === 'published'
                    ? 'No published plugins yet.'
                    : 'No marketplace plugins.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Plugin</th>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Developer</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Installs</th>
                    <th className="px-3 py-2 text-right">Rating</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSelected(p)}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </button>
                        <div className="text-[10px] text-muted-foreground">
                          {p.slug} · v{p.version}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {categoryMeta(p.category).label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/marketplace/developer/${p.developerId}`}
                          className="hover:underline"
                        >
                          {p.developerName}
                        </Link>
                        {p.developerVerified && (
                          <ShieldCheck className="ml-1 inline h-3 w-3 text-emerald-500" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge className={STATUS_TONE[p.status] ?? 'bg-muted'}>
                          {p.status}
                        </Badge>
                        {p.featured && (
                          <Sparkles className="ml-1 inline h-3 w-3 text-amber-500" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.installCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.rating > 0 ? p.rating.toFixed(1) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onVerify(p)}
                            title="Run verification"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelected(p)}
                            title="Review"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Verification result dialog */}
      {verifyTarget && (
        <Dialog
          open={!!verifyTarget}
          onOpenChange={(o) => {
            if (!o) {
              setVerifyTarget(null);
              setVerifyResult(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Verification: {verifyTarget.name}
              </DialogTitle>
              <DialogDescription>
                Running the 6-stage verification pipeline (schema, dependencies,
                permissions, security, sandbox, capabilities).
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              {verifying && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
              {!verifying && verifyResult && (
                <VerificationResultView result={verifyResult} />
              )}
              {!verifying && !verifyResult && (
                <p className="text-sm text-muted-foreground">
                  No result. Click &ldquo;Run verification&rdquo; to start.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() => onVerify(verifyTarget)}
                disabled={verifying}
                variant="outline"
              >
                {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
                Re-run
              </Button>
              <Button
                onClick={() => {
                  setVerifyTarget(null);
                  setVerifyResult(null);
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Detail sheet */}
      <Sheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  {selected.slug} · v{selected.version} · by {selected.developerName}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 px-4 pb-8">
                <div className="flex flex-wrap gap-2">
                  <Badge className={STATUS_TONE[selected.status]}>
                    {selected.status}
                  </Badge>
                  <Badge variant="outline">
                    {categoryMeta(selected.category).label}
                  </Badge>
                  <Badge variant="outline">{selected.pricing.summary}</Badge>
                  {selected.featured && (
                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Sparkles className="h-3 w-3" /> Featured
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {selected.longDescription || selected.description}
                </p>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Installs" value={String(selected.installCount)} />
                  <Stat
                    label="Rating"
                    value={selected.rating > 0 ? selected.rating.toFixed(1) : '—'}
                  />
                  <Stat label="Reviews" value={String(selected.reviewCount)} />
                </div>

                {selected.verification && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Verification</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <VerificationResultView result={selected.verification} compact />
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Capabilities</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-xs">
                      {selected.capabilities.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {c.type}
                          </Badge>
                          <span>{c.name}</span>
                          <code className="text-[10px] text-muted-foreground">
                            {c.id}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Permissions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {selected.permissions.map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/marketplace/plugin/${selected.slug}`} target="_blank">
                      <ExternalLink className="h-3.5 w-3.5" /> View public page
                    </Link>
                  </Button>
                  <Button
                    onClick={() => onVerify(selected)}
                    disabled={verifying}
                    variant="outline"
                    size="sm"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Verify
                  </Button>
                  {['submitted', 'static_analysis', 'security_scan', 'review', 'approved', 'rejected'].includes(selected.status) && (
                    <>
                      <Button
                        onClick={() => setApproveOpen(true)}
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        onClick={() => setRejectOpen(true)}
                        size="sm"
                        variant="outline"
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                  {selected.status === 'published' && (
                    <Button
                      onClick={() => onFeature(selected, !selected.featured)}
                      size="sm"
                      variant="outline"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {selected.featured ? 'Unfeature' : 'Feature'}
                    </Button>
                  )}
                </div>

                {/* Approve dialog */}
                <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Approve {selected.name}</DialogTitle>
                      <DialogDescription>
                        Approving moves the plugin to the &ldquo;approved&rdquo;
                        state. Tick &ldquo;Publish&rdquo; to make it visible on
                        the marketplace immediately.
                      </DialogDescription>
                    </DialogHeader>
                    <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={approvePublish}
                        onChange={(e) => setApprovePublish(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Publish immediately
                    </label>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setApproveOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => onApprove(selected, approvePublish)}
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        Approve
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Reject dialog */}
                <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reject {selected.name}</DialogTitle>
                      <DialogDescription>
                        Provide feedback for the developer. The plugin will be
                        moved to the &ldquo;rejected&rdquo; state and the
                        developer can edit and resubmit.
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      placeholder="What needs to change before this plugin can be approved?"
                      className="min-h-24"
                    />
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRejectOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => onReject(selected, rejectNotes)}
                        className="bg-rose-600 text-white hover:bg-rose-700"
                      >
                        Reject
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Star;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function VerificationResultView({
  result,
  compact,
}: {
  result: VerificationResult;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {result.status === 'passed' ? (
          <ShieldCheck className="h-5 w-5 text-emerald-500" />
        ) : result.status === 'failed' ? (
          <XCircle className="h-5 w-5 text-rose-500" />
        ) : (
          <ShieldAlert className="h-5 w-5 text-amber-500" />
        )}
        <span className="font-medium capitalize">{result.status}</span>
        <Badge variant="outline" className="ml-auto">
          Score: {result.score}/100
        </Badge>
      </div>
      {result.findings.length === 0 ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          No findings — clean manifest.
        </p>
      ) : (
        <ScrollArea className={compact ? 'max-h-48' : 'max-h-64'}>
          <ul className="space-y-1.5">
            {result.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {f.severity === 'error' ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                ) : f.severity === 'warning' ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                )}
                <div>
                  <span className="font-medium uppercase text-muted-foreground">
                    {f.stage}:
                  </span>{' '}
                  {f.message}
                  {f.path && (
                    <code className="ml-1 text-[10px] text-muted-foreground">
                      {f.path}
                    </code>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
