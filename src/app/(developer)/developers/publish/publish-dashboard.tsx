'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  Loader2,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  XCircle,
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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CATEGORY_META,
  type MarketplaceCategory,
} from '@/marketplace';
import type { DeveloperPlugin } from './page';

interface Stats {
  total: number;
  published: number;
  inReview: number;
  drafts: number;
  rejected: number;
  totalInstalls: number;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Submitted', tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  static_analysis: { label: 'Static analysis', tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  security_scan: { label: 'Security scan', tone: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400' },
  review: { label: 'In review', tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  approved: { label: 'Approved', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  published: { label: 'Published', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  rejected: { label: 'Rejected', tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  suspended: { label: 'Suspended', tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  deprecated: { label: 'Deprecated', tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  archived: { label: 'Archived', tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-400' },
};

export function PublishDashboardClient({
  plugins,
  stats,
}: {
  plugins: DeveloperPlugin[];
  stats: Stats;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // New plugin form state.
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<MarketplaceCategory>('settlement-rail');
  const [longDescription, setLongDescription] = React.useState('');

  const onCreate = async () => {
    if (name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (description.trim().length < 10) {
      toast.error('Description must be at least 10 characters');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/developer/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          longDescription: longDescription.trim(),
          pricing: { model: 'free', summary: 'Free' },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Failed to create plugin');
        return;
      }
      toast.success('Plugin created');
      setNewOpen(false);
      setName('');
      setDescription('');
      setLongDescription('');
      router.push(`/developers/publish/${json.plugin.id}`);
    } catch {
      toast.error('Failed to create plugin');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Published" value={stats.published} tone="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="In review" value={stats.inReview} tone="text-amber-600 dark:text-amber-400" />
        <StatCard label="Drafts" value={stats.drafts} tone="text-muted-foreground" />
        <StatCard label="Rejected" value={stats.rejected} tone="text-rose-600 dark:text-rose-400" />
        <StatCard label="Installs" value={stats.totalInstalls} />
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your plugins</h2>
          <p className="text-sm text-muted-foreground">
            Create, edit, submit, and track your published plugins.
          </p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <Button onClick={() => setNewOpen(true)} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> New plugin
          </Button>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create a new plugin</DialogTitle>
              <DialogDescription>
                Start a draft. You can fill in the full manifest, capabilities
                and pricing in the next step.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="name">Plugin name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. MTN Ghana MoMo Rail"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="desc">Short description</Label>
                <Input
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line summary"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as MarketplaceCategory)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_META.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="long">Long description (optional)</Label>
                <Textarea
                  id="long"
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  placeholder="Marketing copy shown on the plugin page."
                  className="mt-1 min-h-20"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewOpen(false)}>
                Cancel
              </Button>
              <Button onClick={onCreate} disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create draft
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Plugin list */}
      {plugins.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-emerald-500" />
          <h3 className="mt-3 text-base font-semibold">No plugins yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first plugin to publish it to the public marketplace.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => (
            <PluginCard key={p.id} plugin={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function PluginCard({ plugin }: { plugin: DeveloperPlugin }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const status = STATUS_META[plugin.status] ?? {
    label: plugin.status,
    tone: 'bg-muted text-muted-foreground',
  };

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/developer/publish/${plugin.id}/submit`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Submit failed');
        return;
      }
      toast.success('Submitted for review');
      router.refresh();
    } catch {
      toast.error('Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/developer/publish/${plugin.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? 'Delete failed');
        return;
      }
      toast.success('Deleted');
      router.refresh();
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <Badge className={status.tone}>{status.label}</Badge>
        </div>
        <CardTitle className="mt-2 text-base font-semibold leading-tight">
          {plugin.name}
        </CardTitle>
        <CardDescription className="line-clamp-2 text-xs">
          {plugin.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-500" />
            {plugin.rating > 0 ? plugin.rating.toFixed(1) : 'New'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Download className="h-3.5 w-3.5" />
            {plugin.installCount}
          </span>
          <span>v{plugin.version}</span>
          <Badge variant="outline" className="text-[10px]">
            {plugin.pricing.summary}
          </Badge>
        </div>

        {plugin.verification && (
          <div className="flex items-center gap-2 rounded-md border p-2 text-xs">
            {plugin.verification.status === 'passed' ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            ) : plugin.verification.status === 'failed' ? (
              <XCircle className="h-3.5 w-3.5 text-rose-500" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span>
              Verification: <span className="font-medium">{plugin.verification.status}</span>{' '}
              (score {plugin.verification.score})
            </span>
          </div>
        )}

        {plugin.status === 'rejected' && plugin.reviewNotes && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs">
            <div className="font-medium text-rose-600 dark:text-rose-400">Reviewer feedback:</div>
            <p className="mt-1 text-muted-foreground">{plugin.reviewNotes}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`/developers/publish/${plugin.id}`}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
          </Button>
          {plugin.status === 'published' && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/developers/publish/${plugin.id}/analytics`}>
                <BarChart3 className="h-3.5 w-3.5" /> Analytics
              </Link>
            </Button>
          )}
          {(plugin.status === 'draft' || plugin.status === 'rejected') && (
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={submitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Submit
            </Button>
          )}
          {plugin.status === 'published' && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/marketplace/plugin/${plugin.slug}`}>
                View <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
          {plugin.status === 'draft' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={deleting}
              className="text-rose-600 hover:text-rose-700"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
