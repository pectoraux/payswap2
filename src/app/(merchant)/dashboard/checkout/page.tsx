'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Eye,
  Code2,
  Save,
  Lock,
  CreditCard,
  ShieldCheck,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

const CURRENCIES = ['GHS', 'USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'];
const THEME_COLORS = [
  { name: 'Emerald', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Slate', value: '#0f172a' },
  { name: 'Rose', value: '#e11d48' },
];

interface CheckoutConfig {
  title: string;
  description: string;
  amount: string;
  currency: string;
  buttonText: string;
  themeColor: string;
}

const DEFAULT_CONFIG: CheckoutConfig = {
  amount: '100.00',
  currency: 'GHS',
  title: 'Pay for your order',
  description: 'Complete your purchase securely with PaySwap.',
  buttonText: 'Pay now',
  themeColor: '#10b981',
};

export default function CheckoutBuilderPage() {
  const [config, setConfig] = useState<CheckoutConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load any previously saved checkout configuration from the merchant's
  // `settings` JSON on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/merchant/settings', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const saved = data?.merchant?.settings?.checkout;
        if (!cancelled && saved && typeof saved === 'object') {
          setConfig((prev) => ({
            ...prev,
            ...DEFAULT_CONFIG,
            ...(saved as Partial<CheckoutConfig>),
          }));
        }
      } catch {
        // Non-fatal — fall back to defaults.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = <K extends keyof CheckoutConfig>(
    key: K,
    value: CheckoutConfig[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));

  const fmt = (n: number, c: string = config.currency) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(
      Number.isFinite(n) ? n : 0,
    );

  const embedCode = `<script
  src="https://cdn.payswap.io/checkout/v1/checkout.js"
  data-merchant="merchant_001"
  data-amount="${config.amount || '0'}"
  data-currency="${config.currency}"
  data-title="${config.title}"
  data-description="${config.description}"
  data-button="${config.buttonText}"
  data-theme="${config.themeColor}"
  async>
</script>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  async function handleSave() {
    setSaving(true);
    try {
      // Merge the new checkout config into any existing settings so we don't
      // clobber unrelated keys (e.g. installed extensions).
      const existing = await fetch('/api/merchant/settings', {
        cache: 'no-store',
      });
      const existingData = existing.ok ? await existing.json() : null;
      const existingSettings =
        existingData?.merchant?.settings &&
        typeof existingData.merchant.settings === 'object'
          ? (existingData.merchant.settings as Record<string, unknown>)
          : {};

      const nextSettings = {
        ...existingSettings,
        checkout: config,
      };

      const res = await fetch('/api/merchant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: nextSettings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save configuration');
      }
      toast.success('Checkout configuration saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save configuration',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checkout builder</h1>
          <p className="text-sm text-muted-foreground">
            Design a hosted checkout page and embed it on your site.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Save configuration
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Configuration form */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Code2 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Configuration</CardTitle>
                <CardDescription>Customize the checkout experience</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={config.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={config.currency}
                  onValueChange={(v) => setField('currency', v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Page title</Label>
              <Input
                id="title"
                value={config.title}
                onChange={(e) => setField('title', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                value={config.description}
                onChange={(e) => setField('description', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="button-text">Button text</Label>
              <Input
                id="button-text"
                value={config.buttonText}
                onChange={(e) => setField('buttonText', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Theme color</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setField('themeColor', c.value)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      config.themeColor === c.value
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: c.value }}
                    />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Embed code</Label>
              <div className="relative">
                <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 pr-10 text-[11px] leading-relaxed text-foreground">
                  <code className="font-mono whitespace-pre-wrap break-all">
                    {embedCode}
                  </code>
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-7 w-7"
                  onClick={handleCopy}
                  title="Copy embed code"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Paste this snippet where you want the checkout button to appear.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Live preview */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
                <Eye className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Live preview</CardTitle>
                <CardDescription>
                  How your customers will see checkout
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              {/* Browser chrome */}
              <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="ml-2 flex-1">
                  <div className="rounded bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    checkout.payswap.io/pay/merchant_001
                  </div>
                </div>
              </div>

              {/* Checkout body */}
              <div className="bg-gradient-to-b from-slate-50 to-slate-100 p-6 dark:from-slate-950 dark:to-slate-900">
                <div className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: config.themeColor }}
                    >
                      <Lock className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      PaySwap
                    </span>
                    <Badge
                      variant="secondary"
                      className="ml-auto text-[9px] text-emerald-600 dark:text-emerald-400"
                    >
                      Secure
                    </Badge>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {config.title || 'Pay for your order'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {config.description || '—'}
                  </p>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Amount due
                    </div>
                    <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {fmt(Number(config.amount) || 0)}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: config.themeColor }}
                  >
                    <CreditCard className="h-4 w-4" />
                    {config.buttonText || 'Pay now'}
                  </button>

                  <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                    <ShieldCheck className="h-3 w-3" />
                    Powered by PaySwap · PCI-DSS compliant
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
