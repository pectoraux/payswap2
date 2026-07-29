import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusBadge } from '@/components/status-badge';
import {
  Globe, TrendingUp, Wallet, Briefcase, Activity,
  Route, History, Shield, CreditCard, ArrowDownToLine,
  RefreshCcw, FileText, Webhook, Play, Zap, Gauge,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminNetworkPage() {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  const env = await getEnvironment();

  // Aggregate network metrics in parallel
  const [
    paymentCount,
    completedPaymentCount,
    failedPaymentCount,
    volumeAgg,
    lpRevenueAgg,
    walletBalanceAgg,
    activeLps,
    amlAlertCount,
    openAmlCount,
    webhookDeliveredCount,
    webhookFailedCount,
    recentAuditLogs,
    corridorAgg,
    topMerchantsByVolume,
  ] = await Promise.all([
    db.payment.count({ where: { environment: env } }),
    db.payment.count({ where: { environment: env, status: 'COMPLETED' } }),
    db.payment.count({ where: { environment: env, status: 'FAILED' } }),
    db.payment.aggregate({
      where: { environment: env, status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      where: { environment: env, status: 'COMPLETED' },
      _sum: { fee: true },
    }),
    db.wallet.aggregate({ _sum: { balance: true } }),
    db.lPProfile.findMany({
      where: { status: 'active' },
      orderBy: { stake: 'desc' },
      take: 10,
    }),
    db.aMLAlert.count({ where: { environment: env } }),
    db.aMLAlert.count({ where: { environment: env, status: 'OPEN' } }),
    db.webhookDelivery.count({ where: { status: 'DELIVERED' } }),
    db.webhookDelivery.count({ where: { status: 'FAILED' } }),
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: true },
    }),
    db.payment.groupBy({
      by: ['corridor'],
      where: { environment: env, status: 'COMPLETED', corridor: { not: null } },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: 8,
    }),
    db.payment.groupBy({
      by: ['merchantId'],
      where: { environment: env, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
  ]);

  // Resolve merchant names for the top merchants list
  const topMerchantIds = topMerchantsByVolume.map((m) => m.merchantId);
  const merchantRecords = topMerchantIds.length > 0
    ? await db.merchant.findMany({
        where: { id: { in: topMerchantIds } },
        select: { id: true, name: true, country: true, currency: true },
      })
    : [];
  const merchantMap = new Map(merchantRecords.map((m) => [m.id, m]));

  // Compute LP utilization (sum of completed payment volume routed via each LP / LP stake)
  const lpIds = activeLps.map((lp) => lp.id);
  const lpVolumeAgg = lpIds.length > 0
    ? await db.payment.groupBy({
        by: ['lpId'],
        where: { environment: env, status: 'COMPLETED', lpId: { in: lpIds } },
        _sum: { amount: true },
        _count: true,
      })
    : [];
  const lpVolumeMap = new Map(lpVolumeAgg.map((l) => [l.lpId, l]));

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const successRate = paymentCount > 0 ? (completedPaymentCount / paymentCount) * 100 : 0;
  const totalVolume = Number(volumeAgg._sum.amount || 0);
  const totalLpRevenue = Number(lpRevenueAgg._sum.fee || 0);
  const totalReserves = Number(walletBalanceAgg._sum.balance || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6 text-emerald-500" />
            Network State
          </h1>
          <p className="text-sm text-muted-foreground">
            Live view of the PaySwap network — volume, reserves, LPs, corridors, and recent activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] capitalize">
            {env} environment
          </Badge>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/admin/runtime">
              <Play className="h-3.5 w-3.5" />
              Run Simulation
            </Link>
          </Button>
        </div>
      </div>

      {/* Network KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Network Volume
              </span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtCurrency(totalVolume)}
              <span className="text-xs text-muted-foreground ml-1">GHS</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {completedPaymentCount.toLocaleString()} completed payments
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total Reserves
              </span>
              <Wallet className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {fmtCurrency(totalReserves)}
              <span className="text-xs text-muted-foreground ml-1">GHS</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">All wallet balances</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payment Success Rate
              </span>
              <Gauge className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {successRate.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {completedPaymentCount.toLocaleString()} succeeded · {failedPaymentCount.toLocaleString()} failed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active LPs
              </span>
              <Briefcase className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{activeLps.length}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {fmtCurrency(activeLps.reduce((s, lp) => s + Number(lp.stake), 0))} GHS total stake
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary stats: LP revenue, AML alerts, webhooks */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                LP Revenue
              </span>
            </div>
            <div className="mt-2 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtCurrency(totalLpRevenue)} GHS
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {totalVolume > 0 ? `${((totalLpRevenue / totalVolume) * 100).toFixed(2)}% effective fee` : '—'}
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <Shield className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                AML Alerts
              </span>
            </div>
            <div className="mt-2 text-lg font-bold tabular-nums">
              {amlAlertCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {openAmlCount.toLocaleString()} open · {(amlAlertCount - openAmlCount).toLocaleString()} resolved
            </div>
          </CardContent>
        </Card>

        <Card className="border-teal-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
                <Webhook className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Webhooks Delivered
              </span>
            </div>
            <div className="mt-2 text-lg font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {webhookDeliveredCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {webhookFailedCount.toLocaleString()} failed · {webhookDeliveredCount + webhookFailedCount > 0
                ? `${((webhookDeliveredCount / (webhookDeliveredCount + webhookFailedCount)) * 100).toFixed(1)}% delivery rate`
                : '—'}
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total Payments
              </span>
            </div>
            <div className="mt-2 text-lg font-bold tabular-nums">
              {paymentCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              All statuses · in {env}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* LP capacity & utilization */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-teal-500" />
            <CardTitle className="text-base">Active Liquidity Providers</CardTitle>
            <CardDescription className="ml-1">
              Capacity, stake, and live utilization across the LP network.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {activeLps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500/10">
                <Briefcase className="h-6 w-6 text-teal-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No active LPs</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Activate LPs in the LP onboarding flow to see them here.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>LP</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Stake</TableHead>
                  <TableHead className="text-right">Routed Volume</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Utilization</TableHead>
                  <TableHead className="text-right">Reputation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLps.map((lp) => {
                  const routed = lpVolumeMap.get(lp.id);
                  const routedVolume = Number(routed?._sum.amount ?? 0);
                  const routedCount = routed?._count ?? 0;
                  const lpStakeNum = Number(lp.stake);
                  const utilization = lpStakeNum > 0 ? (routedVolume / lpStakeNum) * 100 : 0;
                  const utilColor =
                    utilization > 80 ? 'text-rose-600 dark:text-rose-400'
                      : utilization > 50 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400';
                  return (
                    <TableRow key={lp.id}>
                      <TableCell className="font-medium">{lp.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{lp.country}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">{lp.tier}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtCurrency(lpStakeNum)} GHS
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtCurrency(routedVolume)} GHS
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {routedCount.toLocaleString()}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs font-semibold ${utilColor}`}>
                        {utilization.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {(Number(lp.reputation) * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top corridors + Top merchants by volume */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-base">Top Corridors by Volume</CardTitle>
            </div>
            <CardDescription>Where the network is moving money.</CardDescription>
          </CardHeader>
          <CardContent>
            {corridorAgg.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                No corridor activity yet. Run a simulation to populate.
              </div>
            ) : (
              <div className="space-y-2">
                {corridorAgg.map((c, idx) => {
                  const maxVolume = Number(corridorAgg[0]?._sum?.amount ?? 1);
                  const pct = maxVolume > 0 ? ((Number(c._sum?.amount ?? 0)) / maxVolume) * 100 : 0;
                  return (
                    <div key={`${c.corridor}-${idx}`} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground w-4">#{idx + 1}</span>
                          <span className="font-medium">{c.corridor || '—'}</span>
                          <Badge variant="outline" className="text-[9px]">{c._count} txns</Badge>
                        </div>
                        <span className="font-mono tabular-nums">{fmtCurrency(Number(c._sum?.amount ?? 0))} GHS</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-teal-500" />
              <CardTitle className="text-base">Top Merchants by Volume</CardTitle>
            </div>
            <CardDescription>Highest-volume merchants in the network.</CardDescription>
          </CardHeader>
          <CardContent>
            {topMerchantsByVolume.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                No merchant activity yet. Run a simulation to populate.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topMerchantsByVolume.map((m, idx) => {
                    const merchant = merchantMap.get(m.merchantId);
                    return (
                      <TableRow key={m.merchantId}>
                        <TableCell className="text-[10px] text-muted-foreground font-mono">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium text-xs">{merchant?.name ?? m.merchantId.slice(0, 8)}</div>
                          <div className="text-[9px] text-muted-foreground">
                            {merchant?.country ?? '—'} · {merchant?.currency ?? 'GHS'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{m._count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">
                          {fmtCurrency(Number(m._sum?.amount ?? 0))} GHS
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity (last 20 audit logs) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-500" />
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription className="ml-1">
              Last 20 events from the audit log — the live heartbeat of the network.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {recentAuditLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <History className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No activity yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Run a world simulation to generate real activity that flows through every dashboard.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-96 w-full rounded-md border">
              <div className="divide-y">
                {recentAuditLogs.map((log) => {
                  const isPayment = log.action.includes('PAYMENT');
                  const isPayout = log.action.includes('PAYOUT');
                  const isRefund = log.action.includes('REFUND');
                  const isAML = log.action.includes('AML') || log.action.includes('COMPLIANCE');
                  const isWebhook = log.action.includes('WEBHOOK');
                  const Icon = isPayment ? CreditCard : isPayout ? ArrowDownToLine : isRefund ? RefreshCcw : isAML ? Shield : isWebhook ? Webhook : FileText;
                  const color = isPayment ? 'text-emerald-500' : isPayout ? 'text-teal-500' : isRefund ? 'text-amber-500' : isAML ? 'text-rose-500' : isWebhook ? 'text-violet-500' : 'text-muted-foreground';
                  return (
                    <div key={log.id} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                      <div className={`shrink-0 mt-0.5 ${color}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-mono font-medium">{log.action}</span>
                          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                            {fmtDate(log.createdAt)}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {log.user?.email || (log.userId ? log.userId.slice(0, 8) : 'system')}
                          {' · '}
                          {log.resourceType}{log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ''}
                        </div>
                      </div>
                      <StatusBadge status={log.result} />
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
