'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  CreditCard, Globe, Zap, Loader2, Play, CheckCircle2, XCircle, ExternalLink,
  Banknote, Satellite, MapPin, ShieldCheck, Activity, FileText, Route as RouteIcon, FlaskConical,
} from 'lucide-react';
import {
  type LiveProviderResult, type LiveTestResult, type LiveReport, type PlanRouteLiveResult,
  type TestScenarioReport, postShowcase,
} from './shared';

interface ProviderConfig {
  id: string;
  name: string;
  action: string;
  icon: React.ElementType;
  color: string;
  description: string;
  operations: string[];
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'stripe', name: 'Stripe', action: 'liveStripe', icon: CreditCard,
    color: 'border-indigo-500/30 bg-indigo-500/5',
    description: 'Create customer + PaymentIntent ($15) + retrieve — test mode.',
    operations: ['createCustomer', 'createPaymentIntent', 'retrievePaymentIntent'],
  },
  {
    id: 'paystack', name: 'Paystack', action: 'livePaystack', icon: Banknote,
    color: 'border-cyan-500/30 bg-cyan-500/5',
    description: 'List GH banks + initialize 100 GHS transaction + verify — test mode.',
    operations: ['listBanks', 'initializeTransaction', 'verifyTransaction'],
  },
  {
    id: 'flutterwave', name: 'Flutterwave', action: 'liveFlutterwave', icon: Zap,
    color: 'border-orange-500/30 bg-orange-500/5',
    description: 'List GH banks + initiate 75 GHS payment + verify — test mode.',
    operations: ['getBanks', 'initiatePayment', 'verifyPayment'],
  },
  {
    id: 'stellar', name: 'Stellar', action: 'liveStellar', icon: Satellite,
    color: 'border-violet-500/30 bg-violet-500/5',
    description: 'Load account (10K XLM) + submit 1 XLM self-transfer on testnet.',
    operations: ['getAccount', 'sendPayment'],
  },
  {
    id: 'maps', name: 'Google Maps', action: 'liveMaps', icon: MapPin,
    color: 'border-emerald-500/30 bg-emerald-500/5',
    description: 'Geocode Accra + Kumasi + driving distance matrix.',
    operations: ['geocode', 'geocode', 'distanceMatrix'],
  },
];

function TestRow({ result }: { result: LiveTestResult }) {
  const success = result.success;
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-rose-500" />
          )}
          <span className="text-xs font-semibold">{result.operation}</span>
          <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{result.environment}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {result.latencyMs > 0 && <span className="tabular-nums">{result.latencyMs}ms</span>}
          {result.status > 0 && <span className="tabular-nums">HTTP {result.status}</span>}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{result.summary}</p>
      {result.error && (
        <p className="mt-1 text-[10px] text-rose-500">↳ {result.error.slice(0, 200)}</p>
      )}
      {result.rawResponse && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">raw response</summary>
          <pre className="mt-1 max-h-32 overflow-auto overflow-x-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[9px] leading-tight">
{JSON.stringify(result.rawResponse, null, 2).slice(0, 600)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ProviderCard({ config, result, loading, onRun }: {
  config: ProviderConfig;
  result: LiveProviderResult | null;
  loading: boolean;
  onRun: () => void;
}) {
  const Icon = config.icon;
  const allSuccess = result ? Object.values(result.result).every((r) => r.success) : false;
  const anyError = result ? Object.values(result.result).some((r) => !r.success) : false;

  return (
    <Card className={`overflow-hidden border ${config.color}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4" />
            {config.name}
          </CardTitle>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs"
            onClick={onRun} disabled={loading}
          >
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {loading ? 'Running…' : 'Run live test'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{config.description}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {result && (
          <div className="mb-2 flex items-center gap-2">
            {allSuccess ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mr-1 h-3 w-3" /> All passed
              </Badge>
            ) : anyError ? (
              <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <XCircle className="mr-1 h-3 w-3" /> Errors
              </Badge>
            ) : null}
            <span className="text-[10px] text-muted-foreground">{result.message.slice(0, 80)}</span>
          </div>
        )}
        {loading && !result && (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {result && (
          <ScrollArea className="max-h-64 pr-2">
            <div className="space-y-1.5">
              {Object.values(result.result).map((r, i) => (
                <TestRow key={i} result={r} />
              ))}
            </div>
          </ScrollArea>
        )}
        {!result && !loading && (
          <div className="flex h-20 flex-col items-center justify-center rounded-md border border-dashed border-border/50 text-center text-[11px] text-muted-foreground">
            <Icon className="mb-1 h-5 w-5 opacity-30" />
            Click “Run live test” to call the real {config.name} API.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LiveTab() {
  const [results, setResults] = useState<Record<string, LiveProviderResult | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<LiveReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [routeLive, setRouteLive] = useState<PlanRouteLiveResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [scenarios, setScenarios] = useState<TestScenarioReport | null>(null);
  const [scenariosLoading, setScenariosLoading] = useState(false);

  async function runTest(config: ProviderConfig) {
    setLoading((p) => ({ ...p, [config.id]: true }));
    setResults((p) => ({ ...p, [config.id]: null }));
    toast.loading(`Calling ${config.name} API…`, { id: config.id });
    try {
      const r = await postShowcase<LiveProviderResult>({ action: config.action });
      setResults((p) => ({ ...p, [config.id]: r }));
      const ok = Object.values(r.result).every((t) => t.success);
      if (ok) {
        toast.success(`${config.name}: ${r.message}`, { id: config.id });
      } else {
        const errs = Object.values(r.result).filter((t) => !t.success).map((t) => t.error ?? t.summary);
        toast.error(`${config.name}: ${errs[0] ?? 'some tests failed'}`, { id: config.id });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'test failed';
      toast.error(`${config.name}: ${msg}`, { id: config.id });
    } finally {
      setLoading((p) => ({ ...p, [config.id]: false }));
    }
  }

  async function runFullReport() {
    setReportLoading(true); setReport(null);
    toast.loading('Running all 5 live provider tests in parallel…', { id: 'report' });
    try {
      const r = await postShowcase<LiveReport>({ action: 'liveReport' });
      setReport(r);
      toast.success(`Report ${r.reportId}: ${r.summary.passed}/${r.summary.totalTests} passed (${r.summary.passRate}%).`, { id: 'report' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'report failed';
      toast.error(`Report failed: ${msg}`, { id: 'report' });
    } finally {
      setReportLoading(false);
    }
  }

  async function runRouteLive() {
    setRouteLoading(true); setRouteLive(null);
    toast.loading('Planning route with real Google Maps distances…', { id: 'routeLive' });
    try {
      const r = await postShowcase<PlanRouteLiveResult>({ action: 'planRouteLive', priority: 'CHEAPEST' });
      setRouteLive(r);
      toast.success(r.message, { id: 'routeLive' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'route failed';
      toast.error(`Route failed: ${msg}`, { id: 'routeLive' });
    } finally {
      setRouteLoading(false);
    }
  }

  async function runScenarios() {
    setScenariosLoading(true); setScenarios(null);
    toast.loading('Running all 15 TEST-SCENARIOS.md through the kernel…', { id: 'scenarios' });
    try {
      const r = await postShowcase<TestScenarioReport>({ action: 'testScenarios' });
      setScenarios(r);
      toast.success(`Scenarios: ${r.summary.passed}/${r.summary.total} passed (${r.summary.passRate}%).`, { id: 'scenarios' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'scenarios failed';
      toast.error(`Scenarios failed: ${msg}`, { id: 'scenarios' });
    } finally {
      setScenariosLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Live production testing</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Each button below calls a <strong>real sandbox API</strong> with test credentials — Stripe, Paystack, Flutterwave, Stellar (testnet), and Google Maps. These are genuine network round-trips, not simulations. Transactions are created on test infrastructure.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-500" /> Test/sandbox keys only</span>
                <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3 text-emerald-500" /> Real network calls</span>
                <span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3 text-emerald-500" /> Verifiable on provider dashboards</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((config) => (
          <ProviderCard
            key={config.id}
            config={config}
            result={results[config.id] ?? null}
            loading={loading[config.id] ?? false}
            onRun={() => runTest(config)}
          />
        ))}
      </div>

      {/* Full consolidated report */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-emerald-500" /> Consolidated live-test report
            </CardTitle>
            <Button
              size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={runFullReport} disabled={reportLoading}
            >
              {reportLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              {reportLoading ? 'Running all 5…' : 'Run full report'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {report ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
                  <div className="text-lg font-bold text-emerald-600 tabular-nums">{report.summary.passed}</div>
                  <div className="text-[10px] text-muted-foreground">passed</div>
                </div>
                <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2 text-center">
                  <div className="text-lg font-bold text-rose-600 tabular-nums">{report.summary.failed}</div>
                  <div className="text-[10px] text-muted-foreground">failed</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{report.summary.passRate}%</div>
                  <div className="text-[10px] text-muted-foreground">pass rate</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{report.totalLatencyMs}</div>
                  <div className="text-[10px] text-muted-foreground">total ms</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">{report.reportId}</Badge>
                <span>generated {new Date(report.generatedAt).toLocaleString()}</span>
              </div>
              <div className="space-y-2">
                {report.providers.map((p) => (
                  <div key={p.name} className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{p.name}</span>
                      <Badge variant="outline" className={p.failed === 0 ? 'border-emerald-500/40 text-emerald-600' : 'border-amber-500/40 text-amber-600'}>
                        {p.passed}/{p.total} passed
                      </Badge>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {p.tests.map((t, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          {t.success ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />}
                          <span className="font-mono text-muted-foreground">{t.operation}</span>
                          <span className="ml-auto text-muted-foreground tabular-nums">{t.latencyMs}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">View raw JSON report</summary>
                <pre className="mt-2 max-h-48 overflow-auto overflow-x-auto whitespace-pre-wrap break-all rounded bg-background/60 p-3 text-[9px] leading-tight">
{JSON.stringify(report, null, 2).slice(0, 2000)}
                </pre>
              </details>
            </div>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center text-center text-xs text-muted-foreground">
              <FileText className="mb-2 h-6 w-6 opacity-30" />
              Run all 5 providers in parallel and get a consolidated pass/fail report with a report ID.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real-maps route comparison */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <RouteIcon className="h-4 w-4 text-emerald-500" /> Route planner — real Google Maps vs haversine
            </CardTitle>
            <Button
              size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={runRouteLive} disabled={routeLoading}
            >
              {routeLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              {routeLoading ? 'Querying Maps…' : 'Plan with real Maps'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {routeLive ? (
            <div className="space-y-3">
              <div className="rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                {routeLive.message}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{routeLive.route.realTotalKm}</div>
                  <div className="text-[10px] text-muted-foreground">real km</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{routeLive.route.haversineTotalKm}</div>
                  <div className="text-[10px] text-muted-foreground">haversine km</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{routeLive.route.realTotalDurationHours}h</div>
                  <div className="text-[10px] text-muted-foreground">real duration</div>
                </div>
                <div className={`rounded-md border p-2 text-center ${routeLive.route.differencePct > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
                  <div className="text-lg font-bold tabular-nums">{routeLive.route.differencePct > 0 ? '+' : ''}{routeLive.route.differencePct}%</div>
                  <div className="text-[10px] text-muted-foreground">vs straight-line</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {routeLive.route.hops.map((h, i) => (
                  <div key={i} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-600">{h.sequence}</div>
                        <span className="text-xs font-medium">{h.transitNodeName ?? h.address}</span>
                      </div>
                      <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{h.action}</Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                      <span className="text-muted-foreground">haversine: <span className="font-medium text-foreground tabular-nums">{h.haversineKm}km</span></span>
                      <span className="text-muted-foreground">real: <span className="font-medium text-emerald-600 tabular-nums">{h.realKm}km</span></span>
                      <span className="text-muted-foreground">duration: <span className="font-medium text-foreground tabular-nums">{h.realDurationHours.toFixed(2)}h</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center text-center text-xs text-muted-foreground">
              <RouteIcon className="mb-2 h-6 w-6 opacity-30" />
              Plans the multi-hop route with real Google Maps driving distances — compares against the haversine approximation.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test scenarios from TEST-SCENARIOS.md */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FlaskConical className="h-4 w-4 text-emerald-500" /> Test scenarios — TEST-SCENARIOS.md (15 scenarios)
            </CardTitle>
            <Button
              size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={runScenarios} disabled={scenariosLoading}
            >
              {scenariosLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              {scenariosLoading ? 'Running 15…' : 'Run all 15 scenarios'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {scenarios ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
                  <div className="text-lg font-bold text-emerald-600 tabular-nums">{scenarios.summary.passed}</div>
                  <div className="text-[10px] text-muted-foreground">passed</div>
                </div>
                <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2 text-center">
                  <div className="text-lg font-bold text-rose-600 tabular-nums">{scenarios.summary.failed}</div>
                  <div className="text-[10px] text-muted-foreground">failed</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{scenarios.summary.passRate}%</div>
                  <div className="text-[10px] text-muted-foreground">pass rate</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{scenarios.summary.total}</div>
                  <div className="text-[10px] text-muted-foreground">scenarios</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">{scenarios.reportId}</Badge>
                <span>{scenarios.source}</span>
              </div>
              <ScrollArea className="max-h-80 pr-2">
                <div className="space-y-1.5">
                  {scenarios.results.map((r) => (
                    <div key={r.id} className={`rounded-md border px-3 py-2 ${r.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {r.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                          <span className="text-xs font-semibold">S{r.id}: {r.name}</span>
                        </div>
                        <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{r.category}</Badge>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-3">
                        <span>strategy: <span className="font-medium text-foreground">{r.actualStrategy.slice(0, 30)}</span></span>
                        <span>settled: <span className={`font-medium ${r.settled === r.expectedSettled ? 'text-emerald-600' : 'text-rose-600'}`}>{String(r.settled)} (exp {String(r.expectedSettled)})</span></span>
                        {r.metrics && <span>cost: <span className="font-medium text-foreground tabular-nums">{r.metrics.costPercent}%</span></span>}
                        {r.metrics && <span>risk: <span className="font-medium text-foreground">{r.metrics.riskLabel}</span></span>}
                        {r.metrics && <span>time: <span className="font-medium text-foreground">{r.metrics.settlementTimeLabel}</span></span>}
                        {r.eventCount !== undefined && <span>events: <span className="font-medium text-foreground tabular-nums">{r.eventCount}</span></span>}
                        {r.ledgerEntries !== undefined && <span>ledger: <span className="font-medium text-foreground tabular-nums">{r.ledgerEntries}</span></span>}
                      </div>
                      {r.error && <p className="mt-1 text-[10px] text-rose-500">↳ {r.error.slice(0, 150)}</p>}
                      {r.blockReason && !r.settled && (
                        <p className="mt-1 rounded bg-rose-500/5 px-2 py-1 text-[10px] leading-snug text-rose-600 dark:text-rose-400">
                          ⛔ {r.blockReason.slice(0, 180)}
                        </p>
                      )}
                      {r.knownGap && !r.passed && (
                        <p className="mt-1 rounded bg-amber-500/5 px-2 py-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                          ⚠ {r.knownGap}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <details>
                <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">View raw JSON report</summary>
                <pre className="mt-2 max-h-48 overflow-auto overflow-x-auto whitespace-pre-wrap break-all rounded bg-background/60 p-3 text-[9px] leading-tight">
{JSON.stringify(scenarios, null, 2).slice(0, 2500)}
                </pre>
              </details>
            </div>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center text-center text-xs text-muted-foreground">
              <FlaskConical className="mb-2 h-6 w-6 opacity-30" />
              Runs all 15 scenarios from TEST-SCENARIOS.md through the kernel Digital Twin — domestic, cross-border (4 strategies), failed, strategic, refund, payout, concurrent, LP claim, wallet transfer, insufficient funds, emergency freeze, claims.
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
        <div className="mb-2 font-semibold text-foreground">Cross-border settlement flow</div>
        <p className="leading-relaxed">
          The production cross-border flow is: <strong>GHS collected via Paystack/Flutterwave → converted to USDC on Stellar → USDC sent to destination corridor → KES disbursed via local rails</strong>.
          The Stellar test above proves the on-chain settlement leg end-to-end (real transaction on testnet). The PSP tests prove the collection leg. Together they demonstrate the full PaySwap settlement network operating against live infrastructure.
        </p>
        <a
          href="https://stellar.expert/explorer/testnet"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
        >
          <ExternalLink className="h-3 w-3" /> Verify transactions on Stellar testnet explorer
        </a>
      </div>
    </div>
  );
}
