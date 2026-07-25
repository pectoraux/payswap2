import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { KernelSimulationConsole } from '@/components/admin/kernel-simulation-console';
import { Building2, CreditCard, ArrowDownToLine, TrendingUp, History, Cpu } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminRuntimePage() {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  const [merchants, payments, payouts, amlAlerts, lastRuns] = await Promise.all([
    db.merchant.count({ where: { status: 'ACTIVE' } }),
    db.payment.count(),
    db.payout.count(),
    db.aMLAlert.count({ where: { status: 'OPEN' } }),
    db.simulationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);

  const volumeResult = await db.payment.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { amount: true },
  });

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (d: Date) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kernel Runtime & Simulation</h1>
        <p className="text-sm text-muted-foreground">Run transaction scenarios through the frozen 7-primitive kernel — the same planner, executor, and event store that powers production.</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Merchants</span><Building2 className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{merchants}</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payments</span><CreditCard className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{payments}</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payouts</span><ArrowDownToLine className="h-4 w-4 text-emerald-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{payouts}</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AML Alerts</span><Cpu className="h-4 w-4 text-rose-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{amlAlerts}</div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Volume</span><TrendingUp className="h-4 w-4 text-teal-500" /></div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmt(volumeResult._sum.amount || 0)}</div>
        </CardContent></Card>
      </div>

      {/* Kernel Simulation Console */}
      <KernelSimulationConsole />

      {/* Recent simulation runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Recent Kernel Runs</CardTitle>
          <CardDescription>Latest simulation scenarios run through the kernel</CardDescription>
        </CardHeader>
        <CardContent>
          {lastRuns.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No kernel runs yet. Run a scenario above to see results here.</div>
          ) : (
            <div className="space-y-2">
              {lastRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-4 rounded-lg border p-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{run.scenarioName}</div>
                    <div className="text-xs text-muted-foreground">
                      {run.buyerCountry} → {run.merchantCountry} · {run.amount} {run.currency} · {run.priority}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${run.settled ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {run.settled ? 'SETTLED' : 'BLOCKED'}
                      </span>
                      <span className="text-xs text-muted-foreground">{run.costPercent}% cost</span>
                      <span className="text-xs text-muted-foreground">{run.riskScore.toFixed(2)} risk</span>
                      <span className="text-xs text-muted-foreground">{run.confidence}% conf</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(run.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
