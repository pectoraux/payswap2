import Link from 'next/link';
import {
  Cloud, Building2, Globe, ShieldCheck, Puzzle, Check, ArrowRight,
  Server, Zap, Lock, Code2, Users2, BarChart3, Sparkles, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CLOUD_PLAN_CATALOGUE, CLOUD_REGIONS } from '@/cloud';

export const dynamic = 'force-dynamic';

/**
 * /cloud — public marketing page for PaySwap Cloud.
 *
 * Hero, pricing, features, comparison table, and "create tenant" CTA.
 */
export default function CloudLandingPage() {
  const plans = CLOUD_PLAN_CATALOGUE;
  const regions = CLOUD_REGIONS;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white dark:from-emerald-950/20 dark:via-background dark:to-background">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur dark:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Cloud className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold">PaySwap Cloud</span>
            <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              v1.0
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/login">
                Create tenant
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
        <Badge variant="outline" className="mb-4 h-6 px-3 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
          <Sparkles className="mr-1.5 h-3 w-3" />
          The destination: Organizations → Programs → Extensions → Developers → LPs → Merchants → Governments
        </Badge>
        <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          PaySwap Cloud
          <span className="block bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
            Run your financial operating system
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Provision a multi-tenant PaySwap instance on the shared kernel in minutes.
          Built for organizations, governments, and developers — with multi-region deployment,
          compliance-ready controls, and a plugin marketplace.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href="/login">
              Create your first tenant
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/developers/docs">Read the docs</Link>
          </Button>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" /> No credit card required</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" /> Free tier forever</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" /> 8 deployment regions</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" /> 290+ event types out of the box</span>
        </div>
      </section>

      {/* Features */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Everything you need to run a fintech</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              PaySwap Cloud bundles the full kernel — payments, payouts, treasury, LPs, compliance, governance — into one tenant-isolated platform.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Layers className="h-5 w-5" />}
              title="Multi-tenant"
              description="Each tenant gets an isolated PaySwap instance with its own members, programs, deployments, and billing."
            />
            <FeatureCard
              icon={<Globe className="h-5 w-5" />}
              title="Multi-region"
              description="Deploy to 8 regions across Africa, Europe, and the US — with local compliance regions enforced."
            />
            <FeatureCard
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Compliance-ready"
              description="AML, KYC, KYB, sanctions screening, travel rule, and SAR filing built in. Sovereign cloud available for central banks."
            />
            <FeatureCard
              icon={<Puzzle className="h-5 w-5" />}
              title="Plugin marketplace"
              description="Install pre-built extensions or build your own with the Capability SDK. Sandboxed by default."
            />
            <FeatureCard
              icon={<Server className="h-5 w-5" />}
              title="Sandbox / staging / production"
              description="Three isolated environments per tenant. Promote from sandbox → staging → production with one click."
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Usage-based pricing"
              description="Pay for what you use. Base plan + per-transaction, per-API-call, per-GB, and per-extension rates."
            />
            <FeatureCard
              icon={<Lock className="h-5 w-5" />}
              title="Identity OS included"
              description="People, merchants, LPs, organizations, governments, wallets, AI agents, and devices — unified in one identity index."
            />
            <FeatureCard
              icon={<Code2 className="h-5 w-5" />}
              title="Developer-first"
              description="Capability SDK, plugin sandbox, digital twin, time machine, and 8 inspectors — all included."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Simple, transparent pricing</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Start free. Upgrade when you scale. Usage-based charges apply on top of the base plan.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {plans.map((plan) => {
            const isEnterprise = plan.id === 'enterprise';
            const isHighlighted = plan.highlighted;
            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${isHighlighted ? 'border-emerald-500 shadow-lg shadow-emerald-500/10 lg:-mt-2 lg:mb-2' : ''}`}
              >
                {isHighlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="h-5 bg-emerald-600 px-2 text-[10px] text-white hover:bg-emerald-600">Most popular</Badge>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <CardDescription className="text-xs">{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div>
                    {isEnterprise ? (
                      <div className="text-2xl font-bold">Contact sales</div>
                    ) : (
                      <>
                        <span className="text-3xl font-bold tracking-tight">${plan.priceMonthly}</span>
                        <span className="text-sm text-muted-foreground">/mo</span>
                      </>
                    )}
                  </div>
                  <div className="space-y-1 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Merchants</span>
                      <span className="font-medium text-foreground">{plan.limits.maxMerchants.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>LPs</span>
                      <span className="font-medium text-foreground">{plan.limits.maxLPs.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Txns / month</span>
                      <span className="font-medium text-foreground">{plan.limits.maxTransactionsPerMonth.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>API / min</span>
                      <span className="font-medium text-foreground">{plan.limits.maxAPIRequestsPerMinute.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Storage</span>
                      <span className="font-medium text-foreground">{plan.limits.maxStorageGB.toLocaleString()} GB</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Extensions</span>
                      <span className="font-medium text-foreground">{plan.limits.maxExtensions.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex-1" />
                  <Button
                    asChild
                    className={`w-full ${isHighlighted ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
                    variant={isHighlighted ? 'default' : 'outline'}
                    size="sm"
                  >
                    <Link href="/login">
                      {isEnterprise ? 'Contact sales' : plan.priceMonthly === 0 ? 'Start free' : 'Get started'}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 rounded-lg border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Usage-based charges:</span>{' '}
          $0.01 / transaction · $0.10 / 1k API calls · $0.10 / GB-month storage · $5 / extension (over plan allowance)
        </div>
      </section>

      {/* Comparison */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Why PaySwap Cloud?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Compared to building your own financial OS from scratch.
            </p>
          </div>
          <Card className="mt-10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Capability</th>
                    <th className="px-4 py-3 text-center font-medium">Build it yourself</th>
                    <th className="px-4 py-3 text-center font-medium text-emerald-600 dark:text-emerald-400">PaySwap Cloud</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    { cap: 'Multi-currency payments + payouts', self: '6-12 months', cloud: 'Day 1' },
                    { cap: 'Treasury + reserves management', self: '6 months', cloud: 'Day 1' },
                    { cap: 'AML / KYC / sanctions / travel rule', self: '12+ months', cloud: 'Day 1' },
                    { cap: 'Liquidity provider marketplace', self: '6-9 months', cloud: 'Day 1' },
                    { cap: 'Plugin SDK + sandbox', self: '3-6 months', cloud: 'Day 1' },
                    { cap: 'Event-sourced audit trail (290+ events)', self: '6 months', cloud: 'Day 1' },
                    { cap: 'Digital twin + time machine', self: 'Not feasible', cloud: 'Day 1' },
                    { cap: 'Governance council + constitution', self: '3-6 months', cloud: 'Day 1' },
                    { cap: 'Multi-region deployment', self: '3-6 months', cloud: 'Day 1' },
                    { cap: 'Identity OS (8 identity types)', self: '6-12 months', cloud: 'Day 1' },
                    { cap: 'Operations OS (runbooks, on-call, incidents)', self: '6 months', cloud: 'Day 1' },
                    { cap: 'Trust OS (risk engine, attestations)', self: '6-12 months', cloud: 'Day 1' },
                  ].map((row) => (
                    <tr key={row.cap} className="hover:bg-muted/30">
                      <td className="px-4 py-3">{row.cap}</td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">{row.self}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />
                          {row.cloud}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </section>

      {/* Regions */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">8 regions, 6 compliance zones</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Deploy where your users are. Each region enforces the right compliance regime — Ghana, Nigeria, Kenya, EU, US, or global.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {regions.map((r) => (
                <div key={r.id} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{r.label}</span>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{r.complianceRegion}</Badge>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {r.country} · ~{r.latencyMs}ms
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-teal-50 p-6 dark:from-emerald-950/30 dark:to-teal-950/20">
              <Building2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <h3 className="mt-3 text-lg font-semibold">Organizations</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Spin up a tenant for your fintech, PSP, or marketplace. Add team members, deploy to multiple regions, install extensions.
              </p>
            </div>
            <div className="rounded-lg border bg-gradient-to-br from-violet-50 to-purple-50 p-6 dark:from-violet-950/30 dark:to-purple-950/20">
              <Users2 className="h-8 w-8 text-violet-600 dark:text-violet-400" />
              <h3 className="mt-3 text-lg font-semibold">Governments</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Run a sovereign cloud for your central bank or regulator. Sandbox cohorts, CBDC pilots, and regulator-grade audit trails.
              </p>
            </div>
            <div className="rounded-lg border bg-gradient-to-br from-sky-50 to-cyan-50 p-6 dark:from-sky-950/30 dark:to-cyan-950/20">
              <Code2 className="h-8 w-8 text-sky-600 dark:text-sky-400" />
              <h3 className="mt-3 text-lg font-semibold">Developer orgs</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Free tier for evaluation. Build extensions, test integrations, and ship to production when ready.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-emerald-600 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <BarChart3 className="mx-auto h-10 w-10 opacity-80" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Provision your first tenant in 60 seconds
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-emerald-50">
            Sign in with the admin demo account, navigate to the Cloud console, and create your first tenant.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="secondary" className="bg-white text-emerald-700 hover:bg-emerald-50">
              <Link href="/login">
                Get started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-emerald-700 hover:text-white">
              <Link href="/admin/cloud">View admin console</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-white">
              <Cloud className="h-3 w-3" />
            </div>
            <span className="font-semibold text-foreground">PaySwap Cloud</span>
          </div>
          <p className="mt-2">
            The multi-tenant cloud platform for financial operating systems.
            Organizations → Programs → Extensions → Developers → LPs → Merchants → Governments.
          </p>
          <p className="mt-2 text-[10px]">
            © {new Date().getFullYear()} PaySwap Foundation. Built on the PaySwap kernel v1.0.0-cloud.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon, title, description,
}: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {icon}
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
