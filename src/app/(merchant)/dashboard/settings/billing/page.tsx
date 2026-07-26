import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
import {
  CreditCard,
  Check,
  Sparkles,
  Zap,
  Building2,
  Crown,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  PLANS,
  DEFAULT_PLAN,
  getPlan,
  isPlanId,
  type PlanId,
  type Plan,
} from '@/lib/subscription-plans';
import { BillingPlanButton } from '@/components/merchant/billing-plan-button';

export const dynamic = 'force-dynamic';

const PLAN_ICONS: Record<PlanId, React.ReactNode> = {
  starter: <Sparkles className="h-5 w-5" />,
  growth: <Zap className="h-5 w-5" />,
  scale: <Building2 className="h-5 w-5" />,
  enterprise: <Crown className="h-5 w-5" />,
};

function parseSettings(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : {};
  } catch {
    return {};
  }
}

function pct(used: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const value = limit ? pct(used, limit) : 0;
  const barColor =
    value >= 90
      ? 'bg-rose-500'
      : value >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all ${barColor}`}
        style={{ width: `${limit ? value : 8}%` }}
      />
    </div>
  );
}

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) redirect('/unauthorized');

  const env = await getEnvironment();
  const settings = parseSettings(merchant.settings);
  const planId: PlanId = isPlanId(settings?.subscription?.plan)
    ? settings.subscription.plan
    : DEFAULT_PLAN;
  const plan = getPlan(planId);
  const currentRank = PLANS.findIndex((p) => p.id === planId);

  // ── Usage this month ─────────────────────────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [transactions, apiKeys, webhooks, deliveries] = await Promise.all([
    db.payment.count({
      where: {
        merchantId,
        environment: env,
        createdAt: { gte: monthStart },
      },
    }),
    db.apiKey.count({
      where: { merchantId, environment: env, status: 'ACTIVE' },
    }),
    db.webhookEndpoint.count({
      where: { merchantId, environment: env, status: 'ACTIVE' },
    }),
    db.webhookDelivery.count({
      where: {
        createdAt: { gte: monthStart },
        endpoint: { merchantId, environment: env },
      },
    }),
  ]);

  const usage = {
    transactions,
    apiCalls: deliveries,
    webhookDeliveries: deliveries,
    activeApiKeys: apiKeys,
    activeWebhooks: webhooks,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing & Plan</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, view usage, and review billing history.
        </p>
      </div>

      {/* ── Current plan ─────────────────────────────────────────────── */}
      <Card className="border-emerald-500/30 bg-emerald-500/[0.03]">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                {PLAN_ICONS[plan.id]}
              </div>
              <div>
                <CardTitle className="text-base">Current plan: {plan.name}</CardTitle>
                <CardDescription>{plan.tagline}</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                {plan.limits.feePercent}% fee
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {plan.priceLabel}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-card/60 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Transactions / mo
              </div>
              <div className="mt-1 text-sm font-semibold">
                {plan.limits.transactionsPerMonth
                  ? fmtNum(plan.limits.transactionsPerMonth)
                  : 'Unlimited'}
              </div>
            </div>
            <div className="rounded-lg border bg-card/60 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                API keys
              </div>
              <div className="mt-1 text-sm font-semibold">
                {plan.limits.apiKeys ?? 'Unlimited'}
              </div>
            </div>
            <div className="rounded-lg border bg-card/60 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Webhooks
              </div>
              <div className="mt-1 text-sm font-semibold">
                {plan.limits.webhooks ?? 'Unlimited'}
              </div>
            </div>
            <div className="rounded-lg border bg-card/60 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Transaction fee
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {plan.limits.feePercent}%
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {plan.features.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-3 w-3" /> {f}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Usage this month ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions this month</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {fmtNum(usage.transactions)}
              {plan.limits.transactionsPerMonth ? (
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {fmtNum(plan.limits.transactionsPerMonth)}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UsageBar
              used={usage.transactions}
              limit={plan.limits.transactionsPerMonth}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Resets on the 1st of next month.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>API calls this month</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {fmtNum(usage.apiCalls)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Webhook deliveries used as a proxy for outbound API activity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Webhook deliveries this month</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {fmtNum(usage.webhookDeliveries)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Active endpoints: {usage.activeWebhooks} · Active keys: {usage.activeApiKeys}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Pricing grid ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Available plans</h2>
        <p className="text-sm text-muted-foreground">
          Switch plans at any time. Upgrades take effect immediately.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p: Plan, idx: number) => {
          const isCurrent = p.id === plan.id;
          const targetRank = idx;
          const isUpgrade = targetRank > currentRank;
          return (
            <Card
              key={p.id}
              className={
                isCurrent
                  ? 'border-emerald-500/50 shadow-sm'
                  : 'hover:border-emerald-500/30'
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={
                        isCurrent
                          ? 'flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground'
                      }
                    >
                      {PLAN_ICONS[p.id]}
                    </div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                  </div>
                  {isCurrent ? (
                    <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      Current
                    </Badge>
                  ) : isUpgrade ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ArrowUpRight className="h-3 w-3" /> Upgrade
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ArrowDownRight className="h-3 w-3" /> Downgrade
                    </Badge>
                  )}
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold tracking-tight">
                    {p.priceLabel}
                  </span>
                </div>
                <CardDescription className="mt-1">{p.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <BillingPlanButton
                  planId={p.id}
                  planName={p.name}
                  isCurrent={isCurrent}
                  currentRank={currentRank}
                  targetRank={targetRank}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Billing history ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Billing history</CardTitle>
              <CardDescription>
                Invoices and payments for your subscription.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <p className="text-sm">No billing history yet</p>
                    <p className="text-xs text-muted-foreground">
                      Once you upgrade to a paid plan, your invoices will appear here.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
