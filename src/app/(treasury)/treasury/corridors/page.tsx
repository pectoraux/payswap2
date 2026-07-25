import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
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
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
} from '@/components/role-ui';
import { CorridorActions } from '@/components/treasury/corridor-actions';
import {
  Route,
  TrendingUp,
  Activity,
  ArrowRight,
  Snowflake,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface CorridorRow {
  corridor: string;
  volume: number;
  fees: number;
  payments: number;
  completed: number;
  failed: number;
  successRate: number;
  avgSettleMs: number | null;
  activeLps: number;
  frozen: boolean;
}

function parseLpCurrencies(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  } catch {
    /* not JSON — fall through */
  }
  return [];
}

function parseLpCapacity(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, number>;
    }
  } catch {
    /* not JSON */
  }
  return {};
}

export default async function TreasuryCorridorsPage() {
  const session = await getServerSession(authOptions);

  // --- Aggregate by corridor ---------------------------------------------
  const corridorAgg = await db.payment.groupBy({
    by: ['corridor'],
    where: { NOT: { corridor: null } },
    _count: { _all: true },
    _sum: { amount: true, fee: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 50,
  });

  // --- Per-corridor success-rate counts -----------------------------------
  const statusByCorridor = await db.payment.groupBy({
    by: ['corridor', 'status'],
    where: { NOT: { corridor: null } },
    _count: { _all: true },
  });
  const statusMap = new Map<string, Map<string, number>>();
  for (const s of statusByCorridor) {
    if (!s.corridor) continue;
    if (!statusMap.has(s.corridor)) statusMap.set(s.corridor, new Map());
    statusMap.get(s.corridor)!.set(s.status, s._count._all);
  }

  // --- Avg settlement time per corridor (computed in JS from raw rows) ----
  const settledPayments = await db.payment.findMany({
    where: {
      NOT: { corridor: null },
      status: 'COMPLETED',
      settledAt: { not: null },
    },
    select: { corridor: true, createdAt: true, settledAt: true },
    take: 5000,
    orderBy: { createdAt: 'desc' },
  });
  const settleBuckets = new Map<string, { sumMs: number; count: number }>();
  for (const p of settledPayments) {
    if (!p.corridor || !p.settledAt) continue;
    const ms = p.settledAt.getTime() - p.createdAt.getTime();
    if (!Number.isFinite(ms) || ms < 0) continue;
    const cur = settleBuckets.get(p.corridor) ?? { sumMs: 0, count: 0 };
    cur.sumMs += ms;
    cur.count += 1;
    settleBuckets.set(p.corridor, cur);
  }

  // --- LP coverage per corridor ------------------------------------------
  // We map a corridor key (e.g. "GHS→KES") to the count of LPs whose
  // `currencies` array contains both legs OR whose `capacity` JSON has the
  // corridor key.
  const lpProfiles = await db.lPProfile.findMany({
    where: { status: 'active' },
    select: { currencies: true, capacity: true },
  });
  const lpCoverage = new Map<string, number>();
  for (const lp of lpProfiles) {
    const currencies = parseLpCurrencies(lp.currencies);
    const capacity = parseLpCapacity(lp.capacity);
    // LPs explicitly offering a corridor via capacity JSON.
    for (const key of Object.keys(capacity)) {
      lpCoverage.set(key, (lpCoverage.get(key) ?? 0) + 1);
    }
    // LPs whose currency list covers both legs of any corridor they could
    // serve — counted for every corridor whose legs are both in `currencies`.
    if (currencies.length >= 2) {
      for (let i = 0; i < currencies.length; i++) {
        for (let j = 0; j < currencies.length; j++) {
          if (i === j) continue;
          const key = `${currencies[i]}→${currencies[j]}`;
          // Only credit if not already counted via capacity JSON for this LP.
          if (!Object.prototype.hasOwnProperty.call(capacity, key)) {
            lpCoverage.set(key, (lpCoverage.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }

  // --- Frozen corridors (derived from AuditLog) --------------------------
  // The latest TREASURY.CORRIDOR_FREEZE / TREASURY.CORRIDOR_RESUME entry per
  // corridor determines the current state.
  const corridorAuditLogs = await db.auditLog.findMany({
    where: {
      action: { in: ['TREASURY.CORRIDOR_FREEZE', 'TREASURY.CORRIDOR_RESUME'] },
      resourceType: 'corridor',
    },
    orderBy: { createdAt: 'desc' },
    select: { resourceId: true, action: true, createdAt: true },
  });
  const frozenCorridors = new Set<string>();
  for (const log of corridorAuditLogs) {
    if (!log.resourceId) continue;
    if (frozenCorridors.has(log.resourceId)) continue; // first seen = latest
    if (log.action === 'TREASURY.CORRIDOR_FREEZE') {
      frozenCorridors.add(log.resourceId);
    }
  }

  // --- Assemble rows -----------------------------------------------------
  const rows: CorridorRow[] = corridorAgg
    .filter((c) => !!c.corridor)
    .map((c) => {
      const corridor = c.corridor as string;
      const statusCounts = statusMap.get(corridor) ?? new Map<string, number>();
      const total =
        [...statusCounts.values()].reduce((s, n) => s + n, 0) || 1;
      const completed = statusCounts.get('COMPLETED') ?? 0;
      const failed = statusCounts.get('FAILED') ?? 0;
      const successRate = (completed / total) * 100;
      const bucket = settleBuckets.get(corridor);
      const avgSettleMs = bucket && bucket.count > 0 ? bucket.sumMs / bucket.count : null;
      return {
        corridor,
        volume: c._sum.amount ?? 0,
        fees: c._sum.fee ?? 0,
        payments: c._count._all,
        completed,
        failed,
        successRate,
        avgSettleMs,
        activeLps: lpCoverage.get(corridor) ?? 0,
        frozen: frozenCorridors.has(corridor),
      };
    });

  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const totalFees = rows.reduce((s, r) => s + r.fees, 0);
  const totalPayments = rows.reduce((s, r) => s + r.payments, 0);
  const avgFeeBps = totalVolume > 0 ? (totalFees / totalVolume) * 10000 : 0;
  const frozenCount = rows.filter((r) => r.frozen).length;

  // Corridor list (for the rebalance destination dropdown).
  const corridorKeys = rows.map((r) => r.corridor);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corridors"
        description="Settlement routes between currencies — freeze, resume and rebalance from a single console."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active corridors"
          value={rows.length.toString()}
          icon={<Route className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Total volume"
          value={fmtCurrency(totalVolume, 'USD')}
          hint="All-time"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Payments"
          value={fmtNumber(totalPayments, 0).toString()}
          hint="Routed"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Avg fee"
          value={`${fmtNumber(avgFeeBps, 1)} bps`}
          hint={`${frozenCount} frozen`}
          icon={<ArrowRight className="h-4 w-4" />}
          tone={frozenCount > 0 ? 'rose' : 'amber'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4 text-emerald-500" />
            All corridors
          </CardTitle>
          <CardDescription>
            {rows.length} corridor{rows.length === 1 ? '' : 's'} with activity.
            Frozen corridors are highlighted and remain so until manually resumed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Route className="h-6 w-6" />}
              title="No corridor activity"
              description="Corridors appear here once payments are routed between currencies."
            />
          ) : (
            <div className="max-h-[36rem] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corridor</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead>Success</TableHead>
                    <TableHead className="text-right">Avg settle</TableHead>
                    <TableHead className="text-right">LPs</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const otherCorridors = corridorKeys.filter(
                      (k) => k !== r.corridor,
                    );
                    return (
                      <TableRow
                        key={r.corridor}
                        className={
                          r.frozen
                            ? 'bg-rose-500/[0.04] hover:bg-rose-500/[0.06]'
                            : undefined
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold">
                              {r.corridor}
                            </span>
                            {r.frozen && (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-rose-600 dark:text-rose-400">
                                <Snowflake className="h-2.5 w-2.5" />
                                Frozen
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtCurrency(r.volume, 'USD')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(r.fees, 'USD')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(r.payments, 0)}
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={r.successRate}
                              className="h-2"
                            />
                            <span
                              className={`w-10 text-right text-[10px] tabular-nums ${
                                r.successRate >= 95
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : r.successRate >= 80
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {fmtNumber(r.successRate, 0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {r.avgSettleMs !== null
                            ? fmtNumber(r.avgSettleMs, 0) + ' ms'
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.activeLps > 0 ? (
                            <span className="font-semibold text-teal-600 dark:text-teal-400">
                              {r.activeLps}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <CorridorActions
                            corridor={r.corridor}
                            frozen={r.frozen}
                            otherCorridors={otherCorridors}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active corridor freezes */}
      {frozenCount > 0 && (
        <Card className="border-rose-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Snowflake className="h-4 w-4 text-rose-500" />
              Active corridor freezes
            </CardTitle>
            <CardDescription>
              {frozenCount} corridor{frozenCount === 1 ? '' : 's'} currently
              frozen. Use Resume on a row above to lift a freeze.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {rows
                .filter((r) => r.frozen)
                .map((r) => (
                  <span
                    key={r.corridor}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-2 py-1 text-xs font-mono font-semibold text-rose-600 dark:text-rose-400"
                  >
                    <Snowflake className="h-3 w-3" />
                    {r.corridor}
                    <StatusBadge status="FROZEN" />
                  </span>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
