'use client';

import * as React from 'react';
import { Loader2, RefreshCcw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SandboxData {
  id: string;
  state: string;
  createdAt: number;
  lastActivityAt: number;
  resetAt: number | null;
  apiKeys: {
    id: string;
    key: string;
    label: string;
    environment: string;
    scopes: string[];
    createdAt: number;
  }[];
  connectors: {
    id: string;
    name: string;
    mode: string;
    supportedMethods: string[];
    healthy: boolean;
  }[];
  customers: {
    id: string;
    name: string;
    email: string;
    country: string;
  }[];
  products: {
    id: string;
    name: string;
    price: number;
    currency: string;
    sku: string;
  }[];
  payments: {
    id: string;
    customerId: string;
    productId: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    reference: string;
    createdAt: number;
  }[];
  invoices: {
    id: string;
    number: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: number;
  }[];
}

interface Props {
  initialSandbox: SandboxData | null;
}

export function SandboxConsole({ initialSandbox }: Props) {
  const [sandbox, setSandbox] = React.useState<SandboxData | null>(initialSandbox);
  const [resetting, setResetting] = React.useState(false);

  async function reload() {
    try {
      const res = await fetch('/api/developer/sandbox', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setSandbox(data.sandbox);
    } catch (err) {
      console.error('[sandbox] reload failed:', err);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch('/api/developer/sandbox/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to reset sandbox');
      }
      setSandbox(data.sandbox);
      toast.success('Sandbox reset', {
        description: 'All test data has been cleared and re-seeded.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setResetting(false);
    }
  }

  const stats = sandbox
    ? {
        payments: sandbox.payments?.length ?? 0,
        customers: sandbox.customers?.length ?? 0,
        products: sandbox.products?.length ?? 0,
        invoices: sandbox.invoices?.length ?? 0,
        webhooks: 0, // Webhooks are managed on the webhooks page
        events: (sandbox.payments?.length ?? 0) + (sandbox.invoices?.length ?? 0),
      }
    : { payments: 0, customers: 0, products: 0, invoices: 0, webhooks: 0, events: 0 };

  const recentPayments = (sandbox?.payments ?? [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <RefreshCcw className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">
                  Sandbox environment ·{' '}
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {sandbox?.id ?? '—'}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Isolated test data — resets don&apos;t affect production. Last activity:{' '}
                  {sandbox ? new Date(sandbox.lastActivityAt).toLocaleString() : '—'}
                </div>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                  <AlertTriangle className="mr-2 h-4 w-4" /> Reset sandbox
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset sandbox?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears all test customers, products, payments and invoices
                    from your sandbox and re-seeds the initial fixtures. Your API
                    keys and connectors are preserved. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReset}
                    disabled={resetting}
                    className="bg-rose-600 text-white hover:bg-rose-700"
                  >
                    {resetting ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Resetting…
                      </>
                    ) : (
                      'Reset sandbox'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Stats grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Test payments" value={stats.payments} tone="emerald" />
        <StatCard label="Test payouts" value={0} tone="teal" />
        <StatCard label="Test refunds" value={0} tone="amber" />
        <StatCard label="Test webhooks" value={stats.webhooks} tone="cyan" />
        <StatCard label="Test events" value={stats.events} tone="violet" />
        <StatCard label="Test customers" value={stats.customers} tone="emerald" />
      </div>

      {/* API keys + connectors summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sandbox API keys</CardTitle>
            <CardDescription>Use these to authenticate sandbox calls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sandbox?.apiKeys?.length ? (
              sandbox.apiKeys.map((k) => (
                <div key={k.id} className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{k.label}</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                      {k.environment}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] break-all text-muted-foreground">
                    {k.key.slice(0, 24)}…{k.key.slice(-8)}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                No sandbox API keys.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulated connectors</CardTitle>
            <CardDescription>Test PSPs and rails available in your sandbox</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sandbox?.connectors?.length ? (
              sandbox.connectors.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border bg-card/50 p-3">
                  <span
                    className={`flex h-2 w-2 shrink-0 rounded-full ${
                      c.healthy ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {c.supportedMethods.join(' · ')}
                    </div>
                  </div>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">
                    {c.mode}
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                No connectors registered.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent test transactions</CardTitle>
          <CardDescription>
            Last 20 sandbox payments with type, amount, currency, status, created
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentPayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <RefreshCcw className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">No test transactions yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reset the sandbox to seed initial test data, or make a test payment via the API.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Reference</th>
                    <th className="pb-2 pr-3 font-medium">Method</th>
                    <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          payment
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{p.reference}</td>
                      <td className="py-2 pr-3">{p.method}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {p.amount.toFixed(2)} {p.currency}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2 text-right text-[10px] text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const TONE_CLASSES: Record<string, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  teal: 'text-teal-600 dark:text-teal-400',
  amber: 'text-amber-600 dark:text-amber-400',
  cyan: 'text-cyan-600 dark:text-cyan-400',
  violet: 'text-violet-600 dark:text-violet-400',
};

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-xl font-bold tabular-nums ${TONE_CLASSES[tone] ?? ''}`}>{value}</div>
        <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'succeeded' || status === 'COMPLETED' || status === 'DELIVERED'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'failed' || status === 'FAILED'
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
        : status === 'pending' || status === 'PENDING'
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{status}</span>
  );
}
