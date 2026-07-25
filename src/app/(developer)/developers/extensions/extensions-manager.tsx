'use client';

import * as React from 'react';
import { Loader2, Pencil, Plus, Send, Star } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeveloperExtension } from './page';

const CATEGORIES = [
  { value: 'payments', label: 'Payments' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'crm', label: 'CRM' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'other', label: 'Other' },
] as const;

const PRICING_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'freemium', label: 'Freemium' },
] as const;

const PERMISSIONS = [
  { value: 'read_payments', label: 'Read payments' },
  { value: 'write_payments', label: 'Write payments' },
  { value: 'read_customers', label: 'Read customers' },
  { value: 'write_customers', label: 'Write customers' },
  { value: 'send_webhooks', label: 'Send webhooks' },
] as const;

const DEFAULT_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', title: 'API Key' },
    syncFrequency: {
      type: 'string',
      title: 'Sync frequency',
      enum: ['hourly', 'daily', 'weekly'],
      default: 'daily',
    },
  },
  required: ['apiKey'],
};

interface ManagerStats {
  total: number;
  published: number;
  inReview: number;
  drafts: number;
}

interface ManagerProps {
  extensions: DeveloperExtension[];
  stats: ManagerStats;
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

interface FormState {
  name: string;
  description: string;
  category: string;
  pricing: string;
  price: string;
  version: string;
  iconUrl: string;
  permissions: string[];
  config: string;
  changelog: string;
}

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    category: 'payments',
    pricing: 'free',
    price: '0',
    version: '1.0.0',
    iconUrl: '',
    permissions: [],
    config: JSON.stringify(DEFAULT_CONFIG_SCHEMA, null, 2),
    changelog: '',
  };
}

function formFromExtension(e: DeveloperExtension): FormState {
  return {
    name: e.name,
    description: e.description,
    category: e.category,
    pricing: e.pricing,
    price: String(e.price),
    version: e.version,
    iconUrl: e.iconUrl ?? '',
    permissions: e.permissions,
    config: e.config ? JSON.stringify(e.config, null, 2) : JSON.stringify(DEFAULT_CONFIG_SCHEMA, null, 2),
    changelog: '',
  };
}

/**
 * Create / edit dialog. Used for both creating a brand-new extension and
 * editing an existing draft / rejected one.
 */
function ExtensionFormDialog({
  mode,
  extension,
  onSaved,
  trigger,
}: {
  mode: 'create' | 'edit';
  extension?: DeveloperExtension;
  onSaved?: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(
    extension ? formFromExtension(extension) : emptyForm(),
  );

  React.useEffect(() => {
    if (open) {
      setForm(extension ? formFromExtension(extension) : emptyForm());
    }
  }, [open, extension]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function togglePermission(perm: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (form.description.trim().length < 10) {
      toast.error('Description must be at least 10 characters');
      return;
    }
    // Validate config JSON
    let configPayload: string = form.config;
    try {
      JSON.parse(configPayload);
    } catch {
      toast.error('Configuration schema must be valid JSON');
      return;
    }

    setSubmitting(true);
    try {
      const url =
        mode === 'create'
          ? '/api/extensions/create'
          : `/api/extensions/${extension?.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        pricing: form.pricing,
        version: form.version.trim() || '1.0.0',
        permissions: form.permissions,
        config: configPayload,
      };
      if (form.pricing !== 'free') {
        const p = Number(form.price);
        body.price = Number.isFinite(p) && p >= 0 ? p : 0;
      }
      if (form.iconUrl.trim()) body.iconUrl = form.iconUrl.trim();
      if (form.changelog.trim()) body.changelog = form.changelog.trim();

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save extension');
      }
      toast.success(
        mode === 'create' ? 'Extension created' : 'Extension updated',
      );
      setOpen(false);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Create extension' : `Edit ${extension?.name}`}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Submit a new extension to the PaySwap marketplace for review.'
                : 'Update your extension before re-submitting for review.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ext-name">Name</Label>
              <Input
                id="ext-name"
                placeholder="QuickBooks Sync"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                maxLength={80}
                required
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ext-desc">Description</Label>
              <Textarea
                id="ext-desc"
                placeholder="Describe what this extension does for merchants…"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                className="min-h-20"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ext-cat">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => update('category', v)}
              >
                <SelectTrigger id="ext-cat" className="w-full">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ext-ver">Version</Label>
              <Input
                id="ext-ver"
                placeholder="1.0.0"
                value={form.version}
                onChange={(e) => update('version', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ext-pricing">Pricing</Label>
              <Select
                value={form.pricing}
                onValueChange={(v) => update('pricing', v)}
              >
                <SelectTrigger id="ext-pricing" className="w-full">
                  <SelectValue placeholder="Pricing" />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ext-price">
                Price (USD / mo){' '}
                <span className="text-xs text-muted-foreground">
                  {form.pricing === 'free' ? '(n/a)' : ''}
                </span>
              </Label>
              <Input
                id="ext-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => update('price', e.target.value)}
                disabled={form.pricing === 'free'}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ext-icon">Icon URL (optional)</Label>
              <Input
                id="ext-icon"
                placeholder="https://…/icon.png"
                value={form.iconUrl}
                onChange={(e) => update('iconUrl', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.map((p) => {
                const checked = form.permissions.includes(p.value);
                return (
                  <label
                    key={p.value}
                    htmlFor={`perm-${p.value}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors hover:bg-muted/40"
                  >
                    <Checkbox
                      id={`perm-${p.value}`}
                      checked={checked}
                      onCheckedChange={() => togglePermission(p.value)}
                    />
                    <span>{p.label}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Choose the scopes this extension needs. At least one is required to
              submit.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ext-config">Configuration schema (JSON)</Label>
            <Textarea
              id="ext-config"
              value={form.config}
              onChange={(e) => update('config', e.target.value)}
              className="min-h-32 font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              The schema merchants fill out when configuring your extension.
            </p>
          </div>

          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="ext-change">Initial changelog entry</Label>
              <Textarea
                id="ext-change"
                placeholder="Initial release — describes the first version."
                value={form.changelog}
                onChange={(e) => update('changelog', e.target.value)}
                className="min-h-16"
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : mode === 'create' ? (
                'Create extension'
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-row actions: Submit for review (when draft / rejected), Edit (when
 * draft / rejected), View review notes (when rejected).
 */
function ExtensionCard({
  ext,
  onChanged,
}: {
  ext: DeveloperExtension;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const canEdit = ext.status === 'draft' || ext.status === 'rejected';
  const canSubmit = canEdit;

  async function handleSubmitForReview() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/extensions/${ext.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to submit');
      }
      toast.success('Extension submitted for review');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
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
                className="text-[10px] font-mono font-medium"
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

        <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
          <div>
            <div className="text-sm font-semibold tabular-nums">
              {ext.installCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Installs
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold tabular-nums">
              {ext.reviewCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Reviews
            </div>
          </div>
          <div className="flex flex-col items-center">
            <Stars rating={ext.rating} />
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Rating
            </div>
          </div>
        </div>

        {ext.status === 'rejected' && ext.reviewNotes && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
            <div className="font-semibold text-rose-600 dark:text-rose-400">
              Reviewer feedback
            </div>
            <p className="mt-1 text-muted-foreground">{ext.reviewNotes}</p>
          </div>
        )}

        {ext.pricing !== 'free' && (
          <div className="text-xs text-muted-foreground">
            Pricing:{' '}
            <span className="font-semibold text-foreground">
              {ext.pricing === 'paid'
                ? `$${ext.price.toFixed(2)}/mo`
                : 'Freemium'}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <ExtensionFormDialog
              mode="edit"
              extension={ext}
              onSaved={onChanged}
              trigger={
                <Button variant="outline" size="sm" className="h-8">
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
              }
            />
          )}
          {canSubmit && (
            <Button
              size="sm"
              className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={submitting}
              onClick={handleSubmitForReview}
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Submit for review
            </Button>
          )}
          {ext.status === 'submitted' && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400"
            >
              Awaiting review
            </Badge>
          )}
          {ext.status === 'review' && (
            <Badge
              variant="secondary"
              className="bg-sky-500/10 px-2 py-1 text-[11px] text-sky-600 dark:text-sky-400"
            >
              Being reviewed
            </Badge>
          )}
          {ext.status === 'published' && ext.publishedAt && (
            <div className="text-[11px] text-muted-foreground">
              Published {new Date(ext.publishedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DeveloperExtensionsManager({
  extensions,
  stats,
}: ManagerProps) {
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => {
    // Trigger a soft reload of the page so the server-rendered list refreshes.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
    setTick((t) => t + 1);
  }, []);

  return (
    <div className="space-y-4" data-tick={tick}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {stats.total === 0
            ? 'Get started by creating your first extension.'
            : `${stats.total} extension${stats.total === 1 ? '' : 's'} — ${stats.published} live, ${stats.inReview} in review.`}
        </p>
        <ExtensionFormDialog
          mode="create"
          onSaved={reload}
          trigger={
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" /> Create extension
            </Button>
          }
        />
      </div>

      {extensions.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {extensions.map((ext) => (
            <ExtensionCard key={ext.id} ext={ext} onChanged={reload} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
