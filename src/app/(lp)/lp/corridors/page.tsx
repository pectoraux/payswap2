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
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
} from '@/components/role-ui';
import { Route, Coins, Gauge, Activity } from 'lucide-react';
import {
  LpCorridorManager,
  type CorridorRow,
} from '@/components/lp/lp-corridor-manager';

export const dynamic = 'force-dynamic';

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export default async function LpCorridorsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;

  // Gather the per-corridor data we need to render the management table.
  const capacityMap = parseMap(lp?.capacity);
  const feeMap = parseMap(lp?.feeBps);
  const currencies = parseList(lp?.currencies);
  const corridorKeys = Object.keys(capacityMap).sort();

  // Aggregate used capacity & active settlement counts per corridor in one
  // query (much cheaper than N+1).
  const corridorRows: CorridorRow[] = [];
  if (lp && corridorKeys.length > 0) {
    const aggregated = await db.payment.groupBy({
      by: ['corridor'],
      where: {
        lpId: lp.id,
        status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
        corridor: { in: corridorKeys },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const aggMap = new Map<string, { used: number; active: number }>();
    for (const a of aggregated) {
      const key = a.corridor ?? '';
      aggMap.set(key, {
        used: Number(a._sum.amount ?? 0),
        active: a._count._all ?? 0,
      });
    }
    for (const corridor of corridorKeys) {
      const used = aggMap.get(corridor)?.used ?? 0;
      const active = aggMap.get(corridor)?.active ?? 0;
      corridorRows.push({
        corridor,
        capacity: capacityMap[corridor] ?? 0,
        used,
        feeBps: feeMap[corridor] ?? 50,
        activeSettlements: active,
      });
    }
  }

  const totalAllocated = corridorRows.reduce((s, c) => s + c.capacity, 0);
  const totalUsed = corridorRows.reduce((s, c) => s + c.used, 0);
  const overallUtilization =
    totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corridors"
        description="Manage the currency pairs you support, the fees you charge, and the capacity you commit."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Route className="h-6 w-6" />}
              title="No LP profile linked"
              description="Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Active corridors"
              value={corridorRows.length.toString()}
              hint={currencies.length ? `${currencies.length} currencies` : 'No currencies'}
              icon={<Route className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Capacity allocated"
              value={fmtCurrency(totalAllocated, 'USD')}
              hint="Across all corridors"
              icon={<Coins className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Capacity in use"
              value={fmtCurrency(totalUsed, 'USD')}
              hint="Open settlements"
              icon={<Activity className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Utilization"
              value={`${fmtNumber(overallUtilization, 0)}%`}
              hint="Used / allocated"
              icon={<Gauge className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <LpCorridorManager
            corridors={corridorRows}
            existingCurrencies={currencies}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supported currencies</CardTitle>
              <CardDescription>
                Currencies derived from your corridor list. These are the assets
                you are willing to settle in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No currencies yet — add a corridor to get started.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {currencies.map((c) => (
                    <span
                      key={c}
                      className="rounded-lg border bg-card/50 px-3 py-1.5 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
