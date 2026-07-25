import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SimulationConsole } from '@/components/admin/simulation-console';
import {
  Building2,
  CreditCard,
  ArrowDownToLine,
  TrendingUp,
  History,
  Cpu,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminRuntimePage() {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  const [
    merchants,
    payments,
    payouts,
    amlOpen,
    volumeAgg,
    recentSimulations,
  ] = await Promise.all([
    db.merchant.count({ where: { deletedAt: null } }),
    db.payment.count(),
    db.payout.count(),
    db.aMLAlert.count({ where: { status: 'OPEN' } }),
    db.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    db.auditLog.findMany({
      where: { action: { startsWith: 'SIMULATE.' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: true },
    }),
  ]);

  const volume = volumeAgg._sum.amount || 0;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: 0,
    }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const stats = [
    {
      label: 'Merchants',
      value: merchants.toLocaleString(),
      icon: <Building2 className="h-4 w-4 text-emerald-500" />,
      hint: 'Active accounts',
    },
    {
      label: 'Payments',
      value: payments.toLocaleString(),
      icon: <CreditCard className="h-4 w-4 text-teal-500" />,
      hint: 'Total transactions',
    },
    {
      label: 'Payouts',
      value: payouts.toLocaleString(),
      icon: <ArrowDownToLine className="h-4 w-4 text-emerald-500" />,
      hint: 'Total disbursements',
    },
    {
      label: 'Open AML alerts',
      value: amlOpen.toLocaleString(),
      icon: <TrendingUp className="h-4 w-4 text-amber-500" />,
      hint: 'Needs review',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Runtime & simulation</h1>
        <p className="text-sm text-muted-foreground">
          Inspect live system state and run payment scenarios for testing.
        </p>
      </div>

      {/* System state */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </span>
                {s.icon}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Processed volume
            </span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmt(volume)}
          </div>
        </CardContent>
      </Card>

      {/* Scenario runner */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Scenario runner</CardTitle>
              <CardDescription>
                Trigger synthetic events to exercise the protocol end-to-end.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <SimulationConsole />
        </CardContent>
      </Card>

      {/* Recent simulation activity (server-side) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <History className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Recent simulation activity</CardTitle>
              <CardDescription>
                Last 10 audit-logged simulation events
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {recentSimulations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <History className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No simulation history</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Run a scenario above — completed runs will be logged here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {recentSimulations.map((l) => {
                const detail =
                  l.details && l.details.startsWith('{')
                    ? (JSON.parse(l.details) as Record<string, unknown>)
                    : null;
                return (
                  <li
                    key={l.id}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        {l.action}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {l.user?.email || (l.userId ? l.userId.slice(0, 8) : 'system')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 pl-9 text-xs text-muted-foreground sm:pl-0">
                      {detail && (
                        <span className="font-mono text-[10px]">
                          {Object.entries(detail)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(' · ')}
                        </span>
                      )}
                      <span>{fmtDate(l.createdAt)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
