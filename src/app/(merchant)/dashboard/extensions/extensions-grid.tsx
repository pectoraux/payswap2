'use client';

import * as React from 'react';
import {
  Check,
  Loader2,
  PackageOpen,
  Puzzle,
  Settings2,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const CATEGORY_TONES: Record<string, string> = {
  payments: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  analytics: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  compliance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  accounting: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  crm: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  marketing: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  shipping: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  other: 'bg-muted text-muted-foreground',
};

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
  installCount: number;
  rating: number;
  reviewCount: number;
  developerId: string;
  publishedAt: string | null;
  install: MerchantExtensionInstall | null;
}

interface GridProps {
  extensions: MerchantExtension[];
  categories: string[];
  installedCount: number;
}

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
        <span className="text-[10px] text-muted-foreground">
          ({count})
        </span>
      )}
    </span>
  );
}

function PricingTag({
  pricing,
  price,
}: {
  pricing: string;
  price: number;
}) {
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

/**
 * Configure dialog: lets the merchant edit their per-install config values
 * based on the extension's declared config schema.
 */
function ConfigureDialog({
  ext,
  onSaved,
}: {
  ext: MerchantExtension;
  onSaved: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    // Seed from the existing install config or the schema defaults.
    const seeded: Record<string, string> = {};
    const schema = ext.config;
    const existing = ext.install?.config ?? {};
    if (schema && typeof schema === 'object' && 'properties' in schema) {
      const props = (schema as { properties: Record<string, unknown> }).properties;
      for (const [key, def] of Object.entries(props)) {
        const d = def as { default?: unknown; type?: string };
        const existingVal = (existing as Record<string, unknown>)?.[key];
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
  }, [open, ext]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/extensions/${ext.id}/install`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: values }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save configuration');
      }
      toast.success('Configuration saved');
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  // Render a form field per property declared in the schema.
  const schemaProps: Array<[string, { type?: string; title?: string; enum?: string[]; default?: unknown }]> = (() => {
    const schema = ext.config;
    if (!schema || typeof schema !== 'object' || !('properties' in schema)) return [];
    const props = (schema as { properties: Record<string, unknown> }).properties;
    return Object.entries(props).map(([key, def]) => [
      key,
      def as { type?: string; title?: string; enum?: string[]; default?: unknown },
    ]);
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-full">
          <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSave} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Configure {ext.name}</DialogTitle>
            <DialogDescription>
              Update the settings used by this extension for your merchant
              account.
            </DialogDescription>
          </DialogHeader>

          {schemaProps.length === 0 ? (
            <p className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
              This extension does not declare any configuration options.
            </p>
          ) : (
            <div className="space-y-3">
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
                  ) : def.type === 'string' ? (
                    <Input
                      id={`cfg-${key}`}
                      value={values[key] ?? ''}
                      onChange={(e) =>
                        setValues((p) => ({ ...p, [key]: e.target.value }))
                      }
                      placeholder={`Enter ${def.title ?? key}`}
                    />
                  ) : (
                    <Input
                      id={`cfg-${key}`}
                      value={values[key] ?? ''}
                      onChange={(e) =>
                        setValues((p) => ({ ...p, [key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save configuration
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtensionCard({
  ext,
  onChanged,
}: {
  ext: MerchantExtension;
  onChanged: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const isInstalled = !!ext.install;

  async function handleInstall() {
    setPending(true);
    try {
      const res = await fetch(`/api/extensions/${ext.id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to install');
      }
      toast.success('Extension installed');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install');
    } finally {
      setPending(false);
    }
  }

  async function handleUninstall() {
    setPending(true);
    try {
      const res = await fetch(`/api/extensions/${ext.id}/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to uninstall');
      }
      toast.success('Extension uninstalled');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to uninstall');
    } finally {
      setPending(false);
    }
  }

  const tone = CATEGORY_TONES[ext.category] ?? CATEGORY_TONES.other;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`}
          >
            <Puzzle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{ext.name}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className={`text-[9px] ${tone}`}>
                {ext.category}
              </Badge>
              <Badge
                variant="outline"
                className="font-mono text-[9px]"
              >
                v{ext.version}
              </Badge>
              <PricingTag pricing={ext.pricing} price={ext.price} />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <CardDescription className="flex-1 text-xs leading-relaxed">
          {ext.description}
        </CardDescription>

        <div className="flex items-center justify-between border-t pt-3 text-xs">
          <Stars rating={ext.rating} count={ext.reviewCount} />
          <span className="text-muted-foreground tabular-nums">
            {ext.installCount} install{ext.installCount === 1 ? '' : 's'}
          </span>
        </div>

        {isInstalled ? (
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled className="h-9 w-full">
              <Check className="mr-2 h-3.5 w-3.5 text-emerald-500" /> Installed
            </Button>
            <ConfigureDialog ext={ext} onSaved={onChanged} />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-muted-foreground hover:text-rose-500"
              disabled={pending}
              onClick={handleUninstall}
            >
              {pending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Puzzle className="mr-2 h-3.5 w-3.5" />
              )}
              Uninstall
            </Button>
          </div>
        ) : (
          <Button
            className="h-9 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={pending}
            onClick={handleInstall}
          >
            {pending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Puzzle className="mr-2 h-3.5 w-3.5" />
            )}
            Install
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function MerchantExtensionsGrid({
  extensions,
  categories,
  installedCount,
}: GridProps) {
  const [activeCat, setActiveCat] = React.useState<string>('all');
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    return extensions.filter((e) => {
      if (activeCat !== 'all' && e.category !== activeCat) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !e.name.toLowerCase().includes(q) &&
          !e.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [extensions, activeCat, query]);

  const installed = filtered.filter((e) => e.install);
  const available = filtered.filter((e) => !e.install);

  const reload = React.useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  return (
    <div className="space-y-5">
      {/* Category filter chips + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCat('all')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCat === 'all'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCat(c)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                activeCat === c
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search extensions…"
          className="h-8 sm:w-56"
        />
      </div>

      {/* Installed extensions */}
      {installedCount > 0 && installed.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Installed</h2>
            <Badge
              variant="secondary"
              className="bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
            >
              {installed.length}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {installed.map((ext) => (
              <ExtensionCard key={ext.id} ext={ext} onChanged={reload} />
            ))}
          </div>
        </div>
      )}

      {/* Available extensions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Marketplace</h2>
          <Badge variant="secondary" className="text-[10px]">
            {available.length}
          </Badge>
        </div>
        {available.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
            <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No extensions found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different category or search term.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((ext) => (
              <ExtensionCard key={ext.id} ext={ext} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
