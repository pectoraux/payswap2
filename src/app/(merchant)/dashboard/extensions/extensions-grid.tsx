'use client';

import * as React from 'react';
import {
  AlertCircle,
  BarChart3,
  Banknote,
  Boxes,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Eye,
  Heart,
  Loader2,
  type LucideIcon,
  Megaphone,
  Network,
  PackageOpen,
  PiggyBank,
  Puzzle,
  ReceiptText,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  Users,
  Wand2,
  X,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  CATEGORY_SPECS,
  INSTALL_STATUS_META,
  PERMISSION_SPECS,
  categorySpec,
  normalizeInstallStatus,
  permissionDescription,
  permissionLabel,
} from '@/lib/extension-catalog';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface MerchantExtensionInstall {
  installId: string;
  status: string;
  config: Record<string, unknown> | null;
  installedAt: string;
}

export interface MerchantExtension {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  version: string;
  permissions: string[];
  pricing: string;
  price: number;
  config: Record<string, unknown> | null;
  changelog: Array<{ version: string; date: string; changes: string }>;
  installCount: number;
  rating: number;
  reviewCount: number;
  developerId: string;
  publishedAt: string | null;
  featured: boolean;
  install: MerchantExtensionInstall | null;
}

interface MarketplaceProps {
  extensions: MerchantExtension[];
  installedCount: number;
  featuredCount: number;
  popularCount: number;
}

type FilterKey =
  | 'all'
  | 'featured'
  | 'popular'
  | 'installed'
  | string; // any category key

type SortKey = 'popular' | 'newest' | 'rating' | 'name';

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Icon helpers
// ───────────────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Calculator,
  BarChart3,
  Users,
  Megaphone,
  Boxes,
  Heart,
  Banknote,
  ReceiptText,
  PiggyBank,
  Network,
  ShieldCheck,
  Sparkles,
  CreditCard,
  ShieldAlert,
  Truck,
  Puzzle,
};

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const spec = categorySpec(category);
  const Icon = CATEGORY_ICONS[spec.icon] ?? Puzzle;
  return <Icon className={className} />;
}

// ───────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ───────────────────────────────────────────────────────────────────────────

function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 text-amber-500">
        <Star className="h-3 w-3 fill-current" />
        <span className="text-xs font-medium tabular-nums">
          {rating.toFixed(1)}
        </span>
      </span>
      {typeof count === 'number' && (
        <span className="text-[10px] text-muted-foreground">({count})</span>
      )}
    </span>
  );
}

function PricingTag({ pricing, price }: { pricing: string; price: number }) {
  if (pricing === 'free') {
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-500/10 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
      >
        Free
      </Badge>
    );
  }
  if (pricing === 'freemium') {
    return (
      <Badge
        variant="secondary"
        className="bg-teal-500/10 text-[10px] font-medium text-teal-600 dark:text-teal-400"
      >
        Freemium
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400"
    >
      ${price.toFixed(2)}/mo
    </Badge>
  );
}

function InstallStatusBadge({ status }: { status: string }) {
  const meta = INSTALL_STATUS_META[status] ?? INSTALL_STATUS_META.enabled;
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] font-medium ${meta.tone}`}
    >
      {meta.label}
    </Badge>
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

function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ───────────────────────────────────────────────────────────────────────────
// API helpers
// ───────────────────────────────────────────────────────────────────────────

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
      // ignore parse errors
    }
    if (!res.ok) {
      return {
        ok: false,
        data,
        error: data?.error ?? `Request failed (${res.status})`,
      };
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
// Permissions consent dialog
// ───────────────────────────────────────────────────────────────────────────

function PermissionsConsentDialog({
  ext,
  open,
  onOpenChange,
  onAuthorized,
}: {
  ext: MerchantExtension;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAuthorized: (granted: string[]) => Promise<void>;
}) {
  const [granted, setGranted] = React.useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      // Default: all permissions pre-checked (they are required).
      setGranted(new Set(ext.permissions));
    }
  }, [open, ext.permissions]);

  function toggle(key: string) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAuthorize() {
    const missing = ext.permissions.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      toast.error('All requested permissions must be granted to install.');
      return;
    }
    setSubmitting(true);
    try {
      await onAuthorized(Array.from(granted));
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Authorize {ext.name}
          </DialogTitle>
          <DialogDescription>
            This extension needs the following permissions to operate on your
            PaySwap account. All listed scopes are required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {ext.permissions.length === 0 ? (
            <p className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
              This extension does not request any permissions.
            </p>
          ) : (
            ext.permissions.map((key) => {
              const spec = PERMISSION_SPECS.find((p) => p.key === key);
              const isChecked = granted.has(key);
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                    isChecked
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-rose-500/40 bg-rose-500/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(key)}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-emerald-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {spec?.label ?? permissionLabel(key)}
                      </span>
                      <code className="font-mono text-[10px] text-muted-foreground">
                        {key}
                      </code>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {spec?.description ?? permissionDescription(key)}
                    </p>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAuthorize}
            disabled={submitting || ext.permissions.length === 0}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Authorize &amp; Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Configure dialog — renders schema-driven form + JSON editor
// ───────────────────────────────────────────────────────────────────────────

function ConfigureDialog({
  ext,
  onSaved,
  trigger,
}: {
  ext: MerchantExtension;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [jsonMode, setJsonMode] = React.useState(false);
  const [jsonText, setJsonText] = React.useState('{}');

  React.useEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    const schema = ext.config;
    const existing = (ext.install?.config ?? {}) as Record<string, unknown>;
    if (schema && typeof schema === 'object' && 'properties' in schema) {
      const props = (schema as { properties: Record<string, unknown> }).properties;
      for (const [key, def] of Object.entries(props)) {
        const d = def as { default?: unknown; type?: string };
        const existingVal = existing?.[key];
        if (existingVal !== undefined && existingVal !== null) {
          seeded[key] = String(existingVal);
        } else if (d.default !== undefined) {
          seeded[key] = String(d.default);
        } else {
          seeded[key] = '';
        }
      }
    }
    setValues(seeded);
    // Strip the internal __grantedPermissions key from the JSON view.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(existing)) {
      if (k === '__grantedPermissions') continue;
      cleaned[k] = v;
    }
    setJsonText(JSON.stringify(cleaned, null, 2));
  }, [open, ext]);

  async function handleSave() {
    setSubmitting(true);
    try {
      let payload: Record<string, unknown>;
      if (jsonMode) {
        try {
          const parsed = JSON.parse(jsonText);
          if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
            throw new Error('settings must be a JSON object');
          }
          payload = parsed as Record<string, unknown>;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Invalid JSON');
          setSubmitting(false);
          return;
        }
      } else {
        payload = values;
      }
      if (!ext.install) {
        toast.error('Install the extension before configuring it.');
        setSubmitting(false);
        return;
      }
      const { ok, error } = await apiCall(
        `/api/extensions/install/${ext.install.installId}/configure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: payload }),
        },
      );
      if (!ok) {
        toast.error(error ?? 'Failed to save configuration');
        setSubmitting(false);
        return;
      }
      toast.success('Configuration saved');
      setOpen(false);
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  const schemaProps: Array<
    [string, { type?: string; title?: string; enum?: string[]; default?: unknown }]
  > = (() => {
    const schema = ext.config;
    if (!schema || typeof schema !== 'object' || !('properties' in schema)) return [];
    const props = (schema as { properties: Record<string, unknown> }).properties;
    return Object.entries(props).map(([key, def]) => [
      key,
      def as { type?: string; title?: string; enum?: string[]; default?: unknown },
    ]);
  })();

  const triggerEl = trigger ?? (
    <Button variant="outline" size="sm" className="h-8 w-full">
      <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerEl}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure {ext.name}</DialogTitle>
          <DialogDescription>
            Update the settings used by this extension for your merchant
            account. Switch to JSON mode for raw editing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant={!jsonMode ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setJsonMode(false)}
          >
            Form
          </Button>
          <Button
            type="button"
            variant={jsonMode ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setJsonMode(true)}
          >
            JSON
          </Button>
        </div>

        {jsonMode ? (
          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="min-h-48 font-mono text-xs"
            spellCheck={false}
          />
        ) : schemaProps.length === 0 ? (
          <p className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
            This extension does not declare any configuration options.
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <div className="space-y-3 pr-3">
              {schemaProps.map(([key, def]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`cfg-${key}`}>
                    {def.title ?? key}
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      ({key})
                    </span>
                  </Label>
                  {def.enum && Array.isArray(def.enum) ? (
                    <Textarea
                      id={`cfg-${key}`}
                      value={values[key] ?? ''}
                      onChange={(e) =>
                        setValues((p) => ({ ...p, [key]: e.target.value }))
                      }
                      className="min-h-16 font-mono text-xs"
                      placeholder={def.enum.join(' | ')}
                    />
                  ) : (
                    <Input
                      id={`cfg-${key}`}
                      value={values[key] ?? ''}
                      onChange={(e) =>
                        setValues((p) => ({ ...p, [key]: e.target.value }))
                      }
                      placeholder={`Enter ${def.title ?? key}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Extension detail dialog (click a card)
// ───────────────────────────────────────────────────────────────────────────

function ExtensionDetailDialog({
  ext,
  open,
  onOpenChange,
  onChanged,
  onOpenInstall,
}: {
  ext: MerchantExtension;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  onOpenInstall: (ext: MerchantExtension) => void;
}) {
  const [reviews, setReviews] = React.useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'permissions' | 'reviews' | 'changelog'>(
    'overview',
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingReviews(true);
    fetch(`/api/extensions/${ext.id}/reviews`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) setReviews(data.reviews ?? []);
      })
      .catch(() => {
        // ignore — reviews are best-effort
      })
      .finally(() => {
        if (!cancelled) setLoadingReviews(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ext.id]);

  const isInstalled = !!ext.install;
  const installStatus = ext.install ? normalizeInstallStatus(ext.install.status) : null;

  const spec = categorySpec(ext.category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${spec.tone}`}
            >
              <CategoryIcon category={ext.category} className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">{ext.name}</DialogTitle>
              <DialogDescription className="mt-0.5">
                by {ext.developerId.slice(0, 8)}… · v{ext.version} ·{' '}
                {isInstalled ? 'installed' : 'not installed'}
              </DialogDescription>
            </div>
            {isInstalled && installStatus && (
              <InstallStatusBadge status={installStatus} />
            )}
          </div>
        </DialogHeader>

        {/* Tabs (simple pill row — we don't import shadcn Tabs here to keep
            the dialog self-contained). */}
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {(['overview', 'permissions', 'reviews', 'changelog'] as const).map((t) => (
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

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-4 py-2">
            {tab === 'overview' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${spec.tone}`}>
                    {spec.label}
                  </Badge>
                  <PricingTag pricing={ext.pricing} price={ext.price} />
                  {ext.featured && (
                    <Badge
                      variant="secondary"
                      className="bg-fuchsia-500/10 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400"
                    >
                      Featured
                    </Badge>
                  )}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    v{ext.version}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-foreground">
                  {ext.description}
                </p>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Rating
                    </div>
                    <div className="mt-1">
                      <Stars rating={ext.rating} count={ext.reviewCount} />
                    </div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Installs
                    </div>
                    <div className="mt-1 text-sm font-semibold tabular-nums">
                      {ext.installCount}
                    </div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Published
                    </div>
                    <div className="mt-1 text-sm">{fmtDate(ext.publishedAt)}</div>
                  </div>
                </div>
              </>
            )}

            {tab === 'permissions' && (
              <div className="space-y-2">
                {ext.permissions.length === 0 ? (
                  <p className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
                    This extension does not request any permissions.
                  </p>
                ) : (
                  ext.permissions.map((key) => {
                    const spec2 = PERMISSION_SPECS.find((p) => p.key === key);
                    return (
                      <div
                        key={key}
                        className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          <span className="text-sm font-medium">
                            {spec2?.label ?? permissionLabel(key)}
                          </span>
                          <code className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {key}
                          </code>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {spec2?.description ?? permissionDescription(key)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === 'reviews' && (
              <div className="space-y-3">
                {loadingReviews ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-card/50 p-6 text-center">
                    <p className="text-sm font-medium">No reviews yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Be the first to review this extension.
                    </p>
                  </div>
                ) : (
                  reviews.map((r) => (
                    <div key={r.id} className="rounded-md border bg-card/50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {r.user?.name ?? 'Anonymous'}
                        </div>
                        <Stars rating={r.rating} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {r.comment}
                      </p>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {fmtDate(r.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'changelog' && (
              <div className="space-y-2">
                {ext.changelog.length === 0 ? (
                  <p className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
                    No changelog entries.
                  </p>
                ) : (
                  ext.changelog.map((c, i) => (
                    <div key={i} className="rounded-md border bg-card/50 p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          v{c.version}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(c.date)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm">{c.changes}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex flex-wrap items-center gap-2">
          {isInstalled ? (
            <>
              <InstallActions ext={ext} onChanged={onChanged} compact />
              <ConfigureDialog
                ext={ext}
                onSaved={onChanged}
                trigger={
                  <Button variant="outline" size="sm" className="h-9">
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
                  </Button>
                }
              />
            </>
          ) : (
            <Button
              size="sm"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                onOpenChange(false);
                onOpenInstall(ext);
              }}
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Per-install actions (Enable / Disable / Uninstall) — used in the installed
// section AND the detail dialog footer.
// ───────────────────────────────────────────────────────────────────────────

function InstallActions({
  ext,
  onChanged,
  compact = false,
}: {
  ext: MerchantExtension;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!ext.install) return null;
  const status = normalizeInstallStatus(ext.install.status);
  const installId = ext.install.installId;

  async function run(action: string, url: string) {
    setBusy(action);
    const { ok, error } = await apiCall(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    setBusy(null);
    if (!ok) {
      toast.error(error ?? `${action} failed`);
      return;
    }
    toast.success(`${action} succeeded`);
    onChanged();
  }

  const size = compact ? 'sm' : 'default';
  const height = compact ? 'h-9' : 'h-10';

  if (status === 'suspended') {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400"
      >
        Suspended by admin
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'enabled' && (
        <Button
          variant="outline"
          size={size}
          className={height}
          disabled={busy !== null}
          onClick={() => run('disable', `/api/extensions/install/${installId}/disable`)}
        >
          {busy === 'disable' ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Disable
        </Button>
      )}
      {status === 'disabled' && (
        <Button
          size={size}
          className={`${height} bg-emerald-600 text-white hover:bg-emerald-700`}
          disabled={busy !== null}
          onClick={() => run('enable', `/api/extensions/install/${installId}/enable`)}
        >
          {busy === 'enable' ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          Enable
        </Button>
      )}
      <Button
        variant="ghost"
        size={size}
        className={`${height} text-muted-foreground hover:text-rose-500`}
        disabled={busy !== null}
        onClick={() => {
          if (confirm(`Uninstall ${ext.name}? Your configuration will be lost.`)) {
            run('uninstall', `/api/extensions/install/${installId}/uninstall`);
          }
        }}
      >
        {busy === 'uninstall' ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="mr-1.5 h-3.5 w-3.5" />
        )}
        Uninstall
      </Button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog card
// ───────────────────────────────────────────────────────────────────────────

function ExtensionCard({
  ext,
  onChanged,
  onOpenDetail,
  onOpenInstall,
}: {
  ext: MerchantExtension;
  onChanged: () => void;
  onOpenDetail: (ext: MerchantExtension) => void;
  onOpenInstall: (ext: MerchantExtension) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const isInstalled = !!ext.install;
  const installStatus = ext.install ? normalizeInstallStatus(ext.install.status) : null;

  async function handleInstallClick() {
    // If the extension needs permissions, open the consent dialog. Otherwise
    // install directly.
    onOpenInstall(ext);
  }

  async function handleQuickInstall() {
    setPending(true);
    const { ok, error } = await apiCall(`/api/extensions/${ext.id}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionsGranted: ext.permissions }),
    });
    setPending(false);
    if (!ok) {
      toast.error(error ?? 'Failed to install');
      return;
    }
    toast.success('Extension installed');
    onChanged();
  }

  const spec = categorySpec(ext.category);

  return (
    <Card className="group flex flex-col overflow-hidden transition-all hover:border-emerald-500/40 hover:shadow-md">
      <CardHeader className="cursor-pointer pb-3" onClick={() => onOpenDetail(ext)}>
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${spec.tone}`}
          >
            <CategoryIcon category={ext.category} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{ext.name}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className={`text-[9px] ${spec.tone}`}>
                {spec.label}
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px]">
                v{ext.version}
              </Badge>
              <PricingTag pricing={ext.pricing} price={ext.price} />
              {ext.featured && (
                <Badge
                  variant="secondary"
                  className="bg-fuchsia-500/10 text-[9px] font-medium text-fuchsia-600 dark:text-fuchsia-400"
                >
                  Featured
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <CardDescription
          className="flex-1 cursor-pointer text-xs leading-relaxed line-clamp-3"
          onClick={() => onOpenDetail(ext)}
        >
          {ext.description}
        </CardDescription>

        <div className="flex items-center justify-between border-t pt-3 text-xs">
          <Stars rating={ext.rating} count={ext.reviewCount} />
          <span className="text-muted-foreground tabular-nums">
            {ext.installCount.toLocaleString()} installs
          </span>
        </div>

        {isInstalled ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <InstallStatusBadge status={installStatus!} />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => onOpenDetail(ext)}
              >
                <Eye className="mr-1 h-3 w-3" /> Details
              </Button>
            </div>
            <InstallActions ext={ext} onChanged={onChanged} compact />
          </div>
        ) : (
          <Button
            className="h-9 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={pending}
            onClick={handleInstallClick}
          >
            {pending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-3.5 w-3.5" />
            )}
            Install
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Installed section (top of marketplace)
// ───────────────────────────────────────────────────────────────────────────

function InstalledSection({
  extensions,
  onChanged,
  onOpenDetail,
}: {
  extensions: MerchantExtension[];
  onChanged: () => void;
  onOpenDetail: (ext: MerchantExtension) => void;
}) {
  if (extensions.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Your installed extensions</h2>
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
        >
          {extensions.length}
        </Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {extensions.map((ext) => (
          <Card key={ext.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    categorySpec(ext.category).tone
                  }`}
                >
                  <CategoryIcon category={ext.category} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{ext.name}</CardTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <InstallStatusBadge
                      status={normalizeInstallStatus(ext.install!.status)}
                    />
                    <Badge variant="outline" className="font-mono text-[9px]">
                      v{ext.version}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="flex-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                {ext.description}
              </p>
              <div className="flex items-center justify-between border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px]"
                  onClick={() => onOpenDetail(ext)}
                >
                  <Eye className="mr-1 h-3 w-3" /> Details
                </Button>
                <InstallActions ext={ext} onChanged={onChanged} compact />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog grid + sidebar
// ───────────────────────────────────────────────────────────────────────────

const META_FILTERS: Array<{ key: FilterKey; label: string; icon: LucideIcon }> = [
  { key: 'all', label: 'All', icon: Boxes },
  { key: 'featured', label: 'Featured', icon: Sparkles },
  { key: 'popular', label: 'Popular', icon: BarChart3 },
  { key: 'installed', label: 'Installed', icon: Check },
];

export function MerchantMarketplace({
  extensions,
  installedCount,
  featuredCount,
  popularCount,
}: MarketplaceProps) {
  const [activeFilter, setActiveFilter] = React.useState<FilterKey>('all');
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('popular');
  const [detail, setDetail] = React.useState<MerchantExtension | null>(null);
  const [consent, setConsent] = React.useState<MerchantExtension | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const debouncedQuery = useDebouncedValue(query, 200);

  // Local mutable copy of extensions so we can re-render on install/uninstall
  // without a full server reload.
  const [localExts, setLocalExts] = React.useState<MerchantExtension[]>(extensions);
  React.useEffect(() => {
    setLocalExts(extensions);
  }, [extensions, refreshKey]);

  const reload = React.useCallback(async () => {
    // Re-fetch from the API so install state + status are fresh. Omitting
    // merchantId lets the server resolve it from the session.
    const { ok, data } = await apiCall<{
      extensions: Array<{
        id: string;
        install: { installId: string; status: string } | null;
      }>;
    }>('/api/extensions');
    if (!ok || !data) {
      // Fall back to a full page reload.
      if (typeof window !== 'undefined') window.location.reload();
      return;
    }
    const installMap = new Map(
      (data.extensions ?? []).map((e) => [
        e.id,
        e.install as { installId: string; status: string } | null,
      ]),
    );
    setLocalExts((prev) =>
      prev.map((e) => {
        const fresh = installMap.get(e.id);
        if (!fresh) {
          return e.install ? { ...e, install: null } : e;
        }
        if (!e.install) {
          return {
            ...e,
            install: {
              installId: fresh.installId,
              status: fresh.status,
              config: null,
              installedAt: new Date().toISOString(),
            },
          };
        }
        return { ...e, install: { ...e.install, status: fresh.status } };
      }),
    );
    setRefreshKey((k) => k + 1);
  }, []);

  const filtered = React.useMemo(() => {
    let list = localExts;
    if (activeFilter === 'featured') list = list.filter((e) => e.featured);
    else if (activeFilter === 'popular') list = list.filter((e) => e.installCount >= 500);
    else if (activeFilter === 'installed') list = list.filter((e) => e.install);
    else if (activeFilter !== 'all') list = list.filter((e) => e.category === activeFilter);

    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      );
    }

    const sorted = [...list];
    if (sort === 'newest') {
      sorted.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    } else if (sort === 'rating') {
      sorted.sort((a, b) => b.rating - a.rating);
    } else if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => b.installCount - a.installCount);
    }
    return sorted;
  }, [localExts, activeFilter, debouncedQuery, sort]);

  const installedExts = localExts.filter((e) => e.install);
  const availableExts = filtered.filter((e) => !e.install);

  async function handleInstallAuthorized(ext: MerchantExtension, granted: string[]) {
    const { ok, error } = await apiCall(`/api/extensions/${ext.id}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionsGranted: granted }),
    });
    if (!ok) {
      toast.error(error ?? 'Failed to install');
      return;
    }
    toast.success('Extension installed');
    await reload();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside className="space-y-1 lg:sticky lg:top-6 lg:self-start">
        <nav className="space-y-0.5">
          {META_FILTERS.map((f) => {
            const Icon = f.icon;
            const count =
              f.key === 'all'
                ? localExts.length
                : f.key === 'featured'
                  ? featuredCount
                  : f.key === 'popular'
                    ? popularCount
                    : installedCount;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                  activeFilter === f.key
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="flex-1">{f.label}</span>
                <span className="tabular-nums text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </nav>
        <div className="my-2 border-t" />
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Categories
        </div>
        <nav className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {CATEGORY_SPECS.map((c) => {
            const count = localExts.filter((e) => e.category === c.key).length;
            if (count === 0) return null;
            const Icon = CATEGORY_ICONS[c.icon] ?? Puzzle;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setActiveFilter(c.key)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium capitalize transition-colors ${
                  activeFilter === c.key
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="flex-1">{c.label}</span>
                <span className="tabular-nums text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main column */}
      <div className="space-y-6">
        {/* Search + sort */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search extensions by name or description…"
            className="h-9 sm:max-w-md"
          />
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 sm:w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most popular</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="rating">Highest rated</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Installed (only on the "all" / "installed" views) */}
        {(activeFilter === 'all' || activeFilter === 'installed') && (
          <InstalledSection
            extensions={
              activeFilter === 'installed'
                ? installedExts.filter((e) => filtered.includes(e))
                : installedExts
            }
            onChanged={reload}
            onOpenDetail={(e) => setDetail(e)}
          />
        )}

        {/* Catalog */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">
              {activeFilter === 'installed'
                ? 'Available extensions'
                : activeFilter === 'all'
                  ? 'Marketplace'
                  : 'Results'}
            </h2>
            <Badge variant="secondary" className="text-[10px]">
              {activeFilter === 'installed' ? availableExts.length : filtered.length}
            </Badge>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
              <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No extensions found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different category or search term.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 h-8"
                onClick={() => {
                  setActiveFilter('all');
                  setQuery('');
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((ext) => (
                <ExtensionCard
                  key={ext.id}
                  ext={ext}
                  onChanged={reload}
                  onOpenDetail={(e) => setDetail(e)}
                  onOpenInstall={(e) => setConsent(e)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Detail dialog */}
      {detail && (
        <ExtensionDetailDialog
          ext={localExts.find((e) => e.id === detail.id) ?? detail}
          open={!!detail}
          onOpenChange={(v) => !v && setDetail(null)}
          onChanged={reload}
          onOpenInstall={(e) => {
            setDetail(null);
            setConsent(e);
          }}
        />
      )}

      {/* Permissions consent dialog */}
      {consent && (
        <PermissionsConsentDialog
          ext={consent}
          open={!!consent}
          onOpenChange={(v) => !v && setConsent(null)}
          onAuthorized={async (granted) => {
            await handleInstallAuthorized(consent, granted);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Re-export the legacy `MerchantExtensionsGrid` name + type so any other
// import sites still resolve.
// ───────────────────────────────────────────────────────────────────────────

export { MerchantMarketplace as MerchantExtensionsGrid };
