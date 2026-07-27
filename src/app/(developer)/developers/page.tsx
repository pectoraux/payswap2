import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/role-ui';
import {
  BookOpen,
  Compass,
  FlaskConical,
  KeyRound,
  Terminal,
  Copy,
  ArrowRight,
  Code2,
  Webhook,
  Cpu,
  Boxes,
  ScrollText,
  Gauge,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
} from 'lucide-react';
import { developerSandboxId } from '@/lib/developer-context';

export const dynamic = 'force-dynamic';

interface OverviewResponse {
  ok: boolean;
  sandbox?: {
    id: string;
    state: string;
    createdAt: number;
    lastActivityAt: number;
    resetAt: number | null;
    testPayments: number;
    testInvoices: number;
    testCustomers: number;
    testProducts: number;
    connectors: number;
    apiKeys: number;
  } | null;
  apiKeys: {
    id: string;
    label: string;
    keyPrefix: string;
    scopes: string;
    status: string;
    lastUsedAt: string | null;
    createdAt: string;
  }[];
  recentEvents: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: string;
    createdAt: string;
  }[];
  extensions: {
    id: string;
    slug: string;
    name: string;
    status: string;
    version: string;
    installCount: number;
    rating: number;
    updatedAt: string;
  }[];
  merchantId: string | null;
}

async function fetchOverview(token: string): Promise<OverviewResponse | null> {
  try {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/api/developer/overview`, {
      headers: {
        cookie: `next-auth.session-token=${token}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OverviewResponse;
    return data.ok ? data : null;
  } catch (err) {
    console.error('[developers/page] fetchOverview failed:', err);
    return null;
  }
}

const QUICK_LINKS = [
  { label: 'Sandbox', href: '/developers/sandbox', icon: FlaskConical, description: 'Pre-funded test environment' },
  { label: 'API Keys', href: '/developers/api-keys', icon: KeyRound, description: 'Test & live credentials' },
  { label: 'Webhooks', href: '/developers/webhooks', icon: Webhook, description: 'Subscribe & test events' },
  { label: 'Simulator', href: '/developers/simulator', icon: Cpu, description: 'Run the kernel pipeline' },
  { label: 'Extensions', href: '/developers/extensions', icon: Boxes, description: 'Publish to the marketplace' },
  { label: 'Logs', href: '/developers/logs', icon: ScrollText, description: 'Audit trail & errors' },
  { label: 'Metrics', href: '/developers/metrics', icon: Gauge, description: 'Usage & rate limits' },
  { label: 'API Docs', href: '/developers/docs', icon: BookOpen, description: 'Reference & guides' },
];

export default async function DeveloperConsoleHome() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.token?.sub ? undefined : undefined;
  // Server-side fetch needs the session cookie. We'll pass through by reading
  // from the request cookies via next/headers, but the simplest path is to
  // use the db directly. Let's do that.
  const userId = (session?.user as any)?.id as string | undefined;

  // Pull data directly from db + sandboxService so the page is server-rendered
  // without an extra round-trip through the API.
  const { db } = await import('@/lib/db');
  const { sandboxService } = await import('@/protocol/developer');
  const { resolveDeveloperMerchantId } = await import('@/lib/developer-context');
  const { getOrCreateDeveloperSandbox } = await import('@/lib/developer-sandbox');

  let sandbox: OverviewResponse['sandbox'] = null;
  let apiKeys: OverviewResponse['apiKeys'] = [];
  let recentEvents: OverviewResponse['recentEvents'] = [];
  let extensions: OverviewResponse['extensions'] = [];
  let merchantId: string | null = null;

  if (userId) {
    try {
      merchantId = await resolveDeveloperMerchantId(userId);
      const sb = getOrCreateDeveloperSandbox(userId, merchantId);
      sandbox = {
        id: sb.id,
        state: sb.state,
        createdAt: sb.createdAt,
        lastActivityAt: sb.lastActivityAt,
        resetAt: sb.resetAt ?? null,
        testPayments: sb.payments?.length ?? 0,
        testInvoices: sb.invoices?.length ?? 0,
        testCustomers: sb.customers?.length ?? 0,
        testProducts: sb.products?.length ?? 0,
        connectors: sb.connectors?.length ?? 0,
        apiKeys: sb.apiKeys?.length ?? 0,
      };

      if (merchantId) {
        apiKeys = (await db.apiKey.findMany({
          where: { merchantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })).map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes,
          status: k.status,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        }));
      }

      recentEvents = (await db.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })).map((e) => ({
        id: e.id,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ?? null,
        result: e.result,
        createdAt: e.createdAt.toISOString(),
      }));

      extensions = (await db.extension.findMany({
        where: { developerId: userId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          version: true,
          installCount: true,
          rating: true,
          updatedAt: true,
        },
      })).map((e) => ({
        ...e,
        updatedAt: e.updatedAt.toISOString(),
      }));
    } catch (err) {
      console.error('[developers/page] data load failed:', err);
    }
  }

  void token;
  void developerSandboxId;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
                  Developer Console
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {sandbox?.state === 'active' ? 'Sandbox active' : 'Sandbox idle'}
                </Badge>
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                Build on PaySwap
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your isolated sandbox, runtime, simulator, API keys, webhooks,
                and extension store — all in one place. Every test call here
                runs through the exact same kernel pipeline as production.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <Link href="/developers/sandbox">
                    <FlaskConical className="mr-2 h-4 w-4" /> Open sandbox
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/developers/simulator">
                    <Cpu className="mr-2 h-4 w-4" /> Run simulator
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/developers/docs">
                    <BookOpen className="mr-2 h-4 w-4" /> Read docs
                  </Link>
                </Button>
              </div>
            </div>
            <div className="hidden shrink-0 sm:block">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Code2 className="h-12 w-12" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick links
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group rounded-xl border bg-card p-4 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Icon className="h-4 w-4" />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3 text-sm font-semibold">{link.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{link.description}</div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Main grid: sandbox status + API keys + recent events */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sandbox status */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Sandbox status</CardTitle>
                <CardDescription>
                  Your isolated test environment. Reset it any time.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/developers/sandbox">
                  Manage <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {sandbox ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="Test payments"
                    value={sandbox.testPayments}
                  />
                  <Stat
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Test customers"
                    value={sandbox.testCustomers}
                  />
                  <Stat
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Events"
                    value={sandbox.testPayments + sandbox.testInvoices}
                  />
                  <Stat
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Last activity"
                    value={fmtRelative(sandbox.lastActivityAt)}
                  />
                </div>
                <div className="rounded-lg border bg-card/50 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-muted-foreground">{sandbox.id}</span>
                    <Badge
                      className={
                        sandbox.state === 'active'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }
                      variant="secondary"
                    >
                      {sandbox.state}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {sandbox.connectors} connectors · {sandbox.testProducts} test products · {sandbox.testInvoices} test invoices
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Sandbox unavailable. Visit the sandbox page to provision one.
              </div>
            )}
          </CardContent>
        </Card>

        {/* API keys */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">API keys</CardTitle>
                <CardDescription>Authenticate API requests</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/developers/api-keys">
                  Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {apiKeys.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                <KeyRound className="mb-2 h-5 w-5 text-amber-500" />
                No API keys yet. Generate one to start integrating.
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <Link href="/developers/api-keys">
                    Generate key <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ) : (
              apiKeys.map((k) => (
                <div key={k.id} className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{k.label}</span>
                    <Badge
                      className={
                        k.status === 'ACTIVE'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }
                      variant="secondary"
                    >
                      {k.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                    <Copy className="h-3 w-3" />
                    {k.keyPrefix}…
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent events + extensions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>Last 10 audit-log events from your sandbox</CardDescription>
          </CardHeader>
          <CardContent>
            {recentEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Terminal className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run the simulator or make an API call to populate this feed.
                </p>
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {recentEvents.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge
                        className={`font-mono text-[10px] ${
                          e.result === 'SUCCESS'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : e.result === 'ERROR'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                        variant="secondary"
                      >
                        {e.result}
                      </Badge>
                      <span className="font-mono text-[11px] font-medium">{e.action}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {fmtRelative(Date.parse(e.createdAt))}
                      </span>
                    </div>
                    {e.resourceType && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {e.resourceType}
                        {e.resourceId ? ` · ${e.resourceId.slice(0, 12)}` : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Your extensions</CardTitle>
                <CardDescription>Published & in-review</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/developers/extensions">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {extensions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Boxes className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium">No extensions yet</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link href="/developers/extensions">Create extension</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {extensions.map((ext) => (
                  <li key={ext.id} className="rounded-lg border bg-card/50 p-3">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/developers/extensions`}
                        className="truncate text-sm font-semibold hover:underline"
                        title={ext.name}
                      >
                        {ext.name}
                      </Link>
                      <Badge
                        className={
                          ext.status === 'published'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : ext.status === 'submitted' || ext.status === 'review'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground'
                        }
                        variant="secondary"
                      >
                        {ext.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>v{ext.version}</span>
                      <span>{ext.installCount} installs</span>
                      <span>{ext.rating.toFixed(1)} ★</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reference: common endpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Common endpoints</CardTitle>
          <CardDescription>Real API paths exposed by this server</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { method: 'POST', path: '/api/payments/create', description: 'Create a payment intent' },
              { method: 'POST', path: '/api/payouts/create', description: 'Request a payout' },
              { method: 'GET', path: '/api/activity', description: 'Unified activity feed' },
              { method: 'POST', path: '/api/developer/sandbox/reset', description: 'Reset your sandbox' },
              { method: 'POST', path: '/api/developer/simulator/run', description: 'Run a kernel scenario' },
              { method: 'GET', path: '/api/developer/metrics', description: 'Your 24h usage metrics' },
            ].map((e) => (
              <div
                key={e.path + e.method}
                className="rounded-lg border bg-card/50 p-3"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={`shrink-0 font-mono text-[10px] ${
                      e.method === 'GET'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                    }`}
                  >
                    {e.method}
                  </Badge>
                  <code className="truncate font-mono text-[11px] font-semibold">{e.path}</code>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{e.description}</p>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" size="sm" className="mt-3 w-full sm:w-auto">
            <Link href="/developers/explorer">
              <Compass className="mr-1.5 h-3.5 w-3.5" /> Open API Explorer
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
