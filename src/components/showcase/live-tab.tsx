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
  Banknote, Satellite, MapPin, ShieldCheck, Activity,
} from 'lucide-react';
import { type LiveProviderResult, type LiveTestResult, postShowcase } from './shared';

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
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[9px] leading-tight">
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
          <ScrollArea className="max-h-80 pr-2">
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
