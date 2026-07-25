'use client';

import { useState } from 'react';
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
} from 'lucide-react';

const CURRENCIES = ['GHS', 'USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'];
const THEME_COLORS = [
  { name: 'Emerald', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Slate', value: '#0f172a' },
  { name: 'Rose', value: '#e11d48' },
];

export default function CheckoutBuilderPage() {
  const [amount, setAmount] = useState('100.00');
  const [currency, setCurrency] = useState('GHS');
  const [title, setTitle] = useState('Pay for your order');
  const [description, setDescription] = useState('Complete your purchase securely with PaySwap.');
  const [buttonText, setButtonText] = useState('Pay now');
  const [themeColor, setThemeColor] = useState('#10b981');
  const [copied, setCopied] = useState(false);

  const fmt = (n: number, c: string = currency) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(
      Number.isFinite(n) ? n : 0,
    );

  const embedCode = `<script
  src="https://cdn.payswap.io/checkout/v1/checkout.js"
  data-merchant="merchant_001"
  data-amount="${amount || '0'}"
  data-currency="${currency}"
  data-title="${title}"
  data-description="${description}"
  data-button="${buttonText}"
  data-theme="${themeColor}"
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checkout builder</h1>
          <p className="text-sm text-muted-foreground">
            Design a hosted checkout page and embed it on your site.
          </p>
        </div>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Save className="mr-2 h-4 w-4" /> Save configuration
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="button-text">Button text</Label>
              <Input
                id="button-text"
                value={buttonText}
                onChange={(e) => setButtonText(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Theme color</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setThemeColor(c.value)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      themeColor === c.value
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
                      style={{ backgroundColor: themeColor }}
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
                    {title || 'Pay for your order'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {description || '—'}
                  </p>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Amount due
                    </div>
                    <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {fmt(Number(amount) || 0)}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: themeColor }}
                  >
                    <CreditCard className="h-4 w-4" />
                    {buttonText || 'Pay now'}
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
