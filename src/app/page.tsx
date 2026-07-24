'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet, KeyRound, Webhook, Package, QrCode, ArrowDownToLine, ArrowUpRight,
  Shield, CheckCircle2, Clock, AlertCircle, Copy, RefreshCw, Plus, Banknote,
  Smartphone, Link2, Receipt, TrendingUp, Users, Activity, Zap, Layers, GitBranch,
  Server, ExternalLink, Eye, EyeOff, X,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/simulator/theme-toggle';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MerchantAccount {
  id: string; name: string; email: string; country: string; currency: string;
  state: 'pending' | 'verified' | 'active' | 'suspended' | 'closed';
  tier: 'unverified' | 'verified' | 'trusted' | 'premium';
  bond: number; createdAt: number; verifiedAt: number | null;
}

interface ApiKey {
  id: string; key: string; label: string; scopes: string[];
  createdAt: number; lastUsedAt: number | null; active: boolean;
}

interface Product {
  id: string; merchantId: string; name: string; description: string;
  price: number; currency: string; state: 'active' | 'inactive' | 'archived';
}

interface Customer {
  id: string; name: string; email: string; phone: string;
  totalSpent: number; transactionCount: number;
}

interface Invoice {
  id: string; customerId: string; items: { description: string; quantity: number; total: number }[];
  subtotal: number; tax: number; total: number; currency: string;
  state: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'; createdAt: number;
}

interface Analytics {
  totalRevenue: number; totalTransactions: number; averageOrderValue: number;
  refundRate: number; topCustomers: { customerId: string; name: string; totalSpent: number }[];
}

interface TwinTokenAsset {
  code: string; currency: string; issuer: string; totalSupply: number;
  circulating: number; escrowed: number; frozen: number;
}

interface TwinTokenOp {
  id: string; type: string; assetCode: string; amount: number;
  from?: string; to?: string; txHash?: string; status: string; timestamp: number;
}

interface Payout {
  id: string; merchantId: string; method: 'bank' | 'mobile_money' | 'onchain';
  state: 'requested' | 'reviewing' | 'processing' | 'completed' | 'failed' | 'cancelled';
  sourceAsset: string; sourceAmount: number; sourceCurrency: string;
  destinationCurrency: string; destination: { bankAccount?: string; phoneNumber?: string; walletAddress?: string; accountName?: string };
  fxRate: number; feeBps: number; fee: number; netAmount: number;
  txHash?: string; evidence?: { source: string; verificationLevel: string };
  reason?: string; createdAt: number; completedAt: number | null;
}

interface PayoutQuote {
  payoutId: string; method: string; sourceAsset: string; sourceAmount: number;
  sourceCurrency: string; destinationCurrency: string; fxRate: number;
  feeBps: number; fee: number; netAmount: number; estimatedSettlementMs: number;
  availableBalance: number;
}

interface PayoutStats {
  total: number; completed: number; failed: number; pending: number;
  totalVolume: number; totalFees: number;
  byMethod: { bank: number; mobile_money: number; onchain: number };
}

interface WebhookEndpoint {
  id: string; merchantId: string; url: string; secret: string;
  events: string[]; active: boolean; createdAt: number;
}

interface WebhookDelivery {
  id: string; eventType: string; status: string; timestamp: number;
  attempts: number; responseStatus: number | null; signature: string;
}

interface MerchantState {
  merchant: MerchantAccount;
  apiKeys: ApiKey[];
  team: { id: string; email: string; role: string; joinedAt: number | null }[];
  settings: { defaultCurrency: string; webhookUrl: string | null; webhookSecret: string | null; autoSettle: boolean; settlementCurrency: string };
  products: Product[];
  invoices: Invoice[];
  customers: Customer[];
  analytics: Analytics;
  twinToken: {
    asset: TwinTokenAsset;
    balance: number; available: number; escrowed: number; frozen: number;
    operations: TwinTokenOp[];
  };
  payouts: Payout[];
  payoutStats: PayoutStats;
  webhooks: { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] };
  events: { id: string; type: string; ts: number; payload: Record<string, unknown> }[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CCY: Record<string, { symbol: string; flag: string }> = {
  GHS: { symbol: 'GH₵', flag: '🇬🇭' }, KES: { symbol: 'KSh', flag: '🇰🇪' },
  NGN: { symbol: '₦', flag: '🇳🇬' }, USD: { symbol: '$', flag: '🇺🇸' },
  ZAR: { symbol: 'R', flag: '🇿🇦' }, UGX: { symbol: 'USh', flag: '🇺🇬' }, TZS: { symbol: 'TSh', flag: '🇹🇿' },
};
const ccy = (c: string) => CCY[c] ?? { symbol: c + ' ', flag: '🌐' };
const fmt = (n: number, c: string) => `${ccy(c).symbol}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtTs = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const TIER_COLORS: Record<string, string> = {
  unverified: 'bg-zinc-500 text-white', verified: 'bg-amber-500 text-white',
  trusted: 'bg-emerald-600 text-white', premium: 'bg-violet-600 text-white',
};
const STATE_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  verified: 'bg-sky-500/15 text-sky-600 border-sky-500/30',
  active: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  suspended: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
  closed: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
};
const PAYOUT_STATE_COLORS: Record<string, string> = {
  requested: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  reviewing: 'bg-sky-500/15 text-sky-600 border-sky-500/30',
  processing: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  completed: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  failed: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
  cancelled: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
};

const STORAGE_KEY = 'payswap.merchantId';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Home() {
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [state, setState] = useState<MerchantState | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Bootstrap: load merchantId from localStorage, or auto-onboard a demo merchant
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      setMerchantId(stored);
    } else {
      bootstrapDemoMerchant();
    }
  }, []);

  const bootstrapDemoMerchant = useCallback(async () => {
    setBootstrapping(true);
    try {
      // 1. Onboard
      const onboardRes = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'onboard', name: 'Accra Coffee Co.', email: 'founder@accracoffee.gh', country: 'Ghana', currency: 'GHS' }),
      });
      const { merchant } = await onboardRes.json();
      // 2. Verify (5000 bond → trusted tier)
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', merchantId: merchant.id, bond: 5000 }),
      });
      // 3. Webhook (subscribed to payment + payout + twin token events)
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setup_webhook', merchantId: merchant.id, url: 'https://accracoffee.gh/webhooks/payswap',
          events: ['payment.created', 'payment.completed', 'payment.failed', 'payment.disputed', 'payout.requested', 'payout.processing', 'payout.completed', 'payout.failed'],
        }),
      });
      // 4. API key
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_api_key', merchantId: merchant.id, label: 'Production', scopes: ['payments:write', 'payments:read', 'webhooks:read', 'payouts:write'] }),
      });
      // 5. Product
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_product', merchantId: merchant.id, name: 'Single Origin Cocoa Bag', description: '500g single-origin Ghanaian cocoa, roasted in Accra.', price: 75, currency: 'GHS' }),
      });
      // 6. Customer
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_customer', merchantId: merchant.id, name: 'Ama Serwaa', email: 'ama@example.com', phone: '+233244555000' }),
      });
      // 7. Seed Twin Tokens so payouts can be tested immediately
      await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed', merchantId: merchant.id, amount: 25000 }),
      });
      localStorage.setItem(STORAGE_KEY, merchant.id);
      setMerchantId(merchant.id);
      toast.success('Demo merchant ready', { description: 'Accra Coffee Co. · trusted tier · 25,000 TWINGHS' });
    } catch (e) {
      toast.error('Bootstrap failed', { description: e instanceof Error ? e.message : 'unknown' });
    } finally {
      setBootstrapping(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/state?merchantId=${merchantId}`);
      if (!res.ok) throw new Error(`state ${res.status}`);
      const data: MerchantState = await res.json();
      setState(data);
    } catch (e) {
      toast.error('Failed to load merchant state');
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => { if (merchantId) refresh(); }, [merchantId, refresh]);

  const resetMerchant = () => {
    localStorage.removeItem(STORAGE_KEY);
    setMerchantId(null);
    setState(null);
    toast.success('Session cleared', { description: 'Onboarding a fresh demo merchant…' });
    setTimeout(() => bootstrapDemoMerchant(), 400);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <div className="leading-none min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight truncate">PaySwap</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono shrink-0">v2.1</Badge>
              </div>
              <span className="text-[10px] text-muted-foreground truncate block">Merchant Console</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state && (
              <>
                <Badge variant="outline" className="hidden md:flex gap-1 font-mono">
                  <Wallet className="h-3 w-3 text-emerald-500" />
                  {fmt(state.twinToken.available, state.merchant.currency)}
                </Badge>
                <Badge className={`hidden sm:flex gap-1 ${TIER_COLORS[state.merchant.tier] ?? ''}`}>
                  <Shield className="h-3 w-3" />{state.merchant.tier}
                </Badge>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={resetMerchant} className="gap-1 text-muted-foreground">
              <span className="hidden sm:inline">Reset</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {bootstrapping || !state ? (
          <BootSkeleton />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-6">
            {/* Merchant hero */}
            <MerchantHero state={state} />

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
                <TabsTrigger value="overview" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Activity className="h-3.5 w-3.5" />Overview</TabsTrigger>
                <TabsTrigger value="checkout" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><QrCode className="h-3.5 w-3.5" />Checkout</TabsTrigger>
                <TabsTrigger value="payouts" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><ArrowDownToLine className="h-3.5 w-3.5" />Payouts</TabsTrigger>
                <TabsTrigger value="catalog" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Package className="h-3.5 w-3.5" />Catalog</TabsTrigger>
                <TabsTrigger value="api" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><KeyRound className="h-3.5 w-3.5" />API & Webhooks</TabsTrigger>
                <TabsTrigger value="events" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><GitBranch className="h-3.5 w-3.5" />Events</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4"><OverviewTab state={state} /></TabsContent>
              <TabsContent value="checkout" className="mt-4 space-y-4"><CheckoutTab state={state} onRefresh={refresh} /></TabsContent>
              <TabsContent value="payouts" className="mt-4 space-y-4"><PayoutsTab state={state} merchantId={merchantId!} onRefresh={refresh} /></TabsContent>
              <TabsContent value="catalog" className="mt-4 space-y-4"><CatalogTab state={state} merchantId={merchantId!} onRefresh={refresh} /></TabsContent>
              <TabsContent value="api" className="mt-4 space-y-4"><ApiTab state={state} merchantId={merchantId!} onRefresh={refresh} /></TabsContent>
              <TabsContent value="events" className="mt-4 space-y-4"><EventsTab state={state} /></TabsContent>
            </Tabs>
          </motion.div>
        )}
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-center sm:flex-row sm:text-left">
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">PaySwap Merchant Console</span> ·
            frozen kernel (7 primitives) · protocol-layer product · zero kernel changes
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {state ? `${state.merchant.id.slice(0, 20)} · ${state.twinToken.asset.code} available ${fmt(state.twinToken.available, state.merchant.currency)}` : 'no merchant'}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Boot skeleton ───────────────────────────────────────────────────────────

function BootSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

// ─── Merchant hero ──────────────────────────────────────────────────────────

function MerchantHero({ state }: { state: MerchantState }) {
  const m = state.merchant;
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-lg shadow">
              {m.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight truncate">{m.name}</h1>
                <Badge variant="outline" className={`gap-1 ${STATE_COLORS[m.state]}`}>
                  <CheckCircle2 className="h-3 w-3" />{m.state}
                </Badge>
                <Badge className={`gap-1 ${TIER_COLORS[m.tier]}`}>
                  <Shield className="h-3 w-3" />{m.tier}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>{ccy(m.currency).flag} {m.country}</span>
                <span>·</span>
                <span className="font-mono">{m.email}</span>
                <span>·</span>
                <span>Bond: {fmt(m.bond, m.currency)}</span>
                <span>·</span>
                <span className="font-mono text-[10px]">{m.id.slice(0, 24)}…</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-4">
            <HeroStat label="Available" value={fmt(state.twinToken.available, m.currency)} icon={<Wallet className="h-3.5 w-3.5" />} accent="emerald" />
            <HeroStat label="Revenue" value={fmt(state.analytics.totalRevenue, m.currency)} icon={<TrendingUp className="h-3.5 w-3.5" />} accent="teal" />
            <HeroStat label="Txns" value={String(state.analytics.totalTransactions)} icon={<Receipt className="h-3.5 w-3.5" />} accent="emerald" />
            <HeroStat label="Payouts" value={String(state.payoutStats.completed)} icon={<ArrowDownToLine className="h-3.5 w-3.5" />} accent="teal" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroStat({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: 'emerald' | 'teal' }) {
  const color = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-teal-600 dark:text-teal-400';
  return (
    <div className="rounded-lg border bg-background/60 p-2.5 min-w-[88px]">
      <div className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${color}`}>{icon}{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({ state }: { state: MerchantState }) {
  const m = state.merchant;
  return (
    <>
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Revenue" value={fmt(state.analytics.totalRevenue, m.currency)} sub={`${state.analytics.totalTransactions} transactions`} icon={<TrendingUp className="h-4 w-4" />} accent="emerald" />
        <KpiCard label="Avg Order Value" value={fmt(state.analytics.averageOrderValue, m.currency)} sub={`${(state.analytics.refundRate * 100).toFixed(1)}% refund rate`} icon={<Receipt className="h-4 w-4" />} accent="teal" />
        <KpiCard label="Twin Token Supply" value={fmt(state.twinToken.asset.circulating, m.currency)} sub={`${state.twinToken.asset.escrowed} escrowed`} icon={<Zap className="h-4 w-4" />} accent="emerald" />
        <KpiCard label="Payout Volume" value={fmt(state.payoutStats.totalVolume, m.currency)} sub={`${state.payoutStats.totalFees} fees earned`} icon={<ArrowDownToLine className="h-4 w-4" />} accent="teal" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Twin Token balance */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-emerald-500" />Twin Token Balance</CardTitle>
            <CardDescription className="text-xs">{state.twinToken.asset.code} · pegged to {state.twinToken.asset.currency} · Stellar issuer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
              <div className="text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">Available</div>
              <div className="text-2xl font-bold tabular-nums">{fmt(state.twinToken.available, m.currency)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Total balance:</span> <span className="font-semibold tabular-nums">{fmt(state.twinToken.balance, m.currency)}</span></div>
              <div><span className="text-muted-foreground">Escrowed:</span> <span className="font-semibold tabular-nums">{fmt(state.twinToken.escrowed, m.currency)}</span></div>
              <div><span className="text-muted-foreground">Frozen:</span> <span className="font-semibold tabular-nums">{fmt(state.twinToken.frozen, m.currency)}</span></div>
              <div><span className="text-muted-foreground">Asset supply:</span> <span className="font-semibold tabular-nums">{fmt(state.twinToken.asset.totalSupply, m.currency)}</span></div>
            </div>
            <Separator />
            <div className="text-[10px] font-mono text-muted-foreground break-all">issuer: {state.twinToken.asset.issuer}</div>
          </CardContent>
        </Card>

        {/* Recent twin token operations */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-teal-500" />Recent Token Operations</CardTitle>
            <CardDescription className="text-xs">On-chain Stellar evidence · cryptographic verification</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-72">
              {state.twinToken.operations.length === 0 ? (
                <EmptyState icon={<Zap className="h-5 w-5" />} title="No operations yet" sub="Mint, transfer, or escrow activity will appear here." />
              ) : (
                <div className="space-y-2">
                  {state.twinToken.operations.map((op) => (
                    <div key={op.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-xs">
                      <OpIcon type={op.type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold uppercase">{op.type}</span>
                          <Badge variant="outline" className="h-3.5 px-1 text-[9px]">{op.assetCode}</Badge>
                          <Badge variant="outline" className={`h-3.5 px-1 text-[9px] ${op.status === 'confirmed' ? 'text-emerald-600 border-emerald-500/30' : 'text-rose-600 border-rose-500/30'}`}>{op.status}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-0.5 font-mono text-[10px] truncate">
                          {op.from ?? '—'} → {op.to ?? '—'} · {op.txHash ?? 'no-tx'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold tabular-nums">{op.amount}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtTs(op.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Top customers + recent payouts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-emerald-500" />Top Customers</CardTitle></CardHeader>
          <CardContent>
            {state.analytics.topCustomers.length === 0 ? (
              <EmptyState icon={<Users className="h-5 w-5" />} title="No customers yet" sub="Create a customer in the Catalog tab." />
            ) : (
              <div className="space-y-2">
                {state.analytics.topCustomers.map((c, i) => (
                  <div key={c.customerId} className="flex items-center gap-3 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{i + 1}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="font-semibold tabular-nums">{fmt(c.totalSpent, m.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4 text-teal-500" />Recent Payouts</CardTitle></CardHeader>
          <CardContent>
            {state.payouts.length === 0 ? (
              <EmptyState icon={<ArrowDownToLine className="h-5 w-5" />} title="No payouts yet" sub="Withdraw your Twin Token balance in the Payouts tab." />
            ) : (
              <div className="space-y-2">
                {state.payouts.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 text-xs">
                    <MethodIcon method={p.method} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.method === 'onchain' ? 'On-chain' : p.method === 'bank' ? 'Bank' : 'Mobile money'} · {p.sourceAsset}</div>
                      <div className="text-muted-foreground text-[10px] font-mono truncate">{p.txHash ?? p.id.slice(0, 24)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">{fmt(p.netAmount, p.destinationCurrency)}</div>
                      <Badge variant="outline" className={`h-3.5 px-1 text-[9px] ${PAYOUT_STATE_COLORS[p.state]}`}>{p.state}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({ label, value, sub, icon, accent }: { label: string; value: string; sub: string; icon: React.ReactNode; accent: 'emerald' | 'teal' }) {
  const color = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-teal-600 dark:text-teal-400 bg-teal-500/10';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${color}`}>{icon}</span>
        </div>
        <div className="mt-2 text-xl font-bold tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function OpIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ReactNode; color: string }> = {
    mint: { icon: <Plus className="h-3.5 w-3.5" />, color: 'bg-emerald-500/15 text-emerald-600' },
    burn: { icon: <X className="h-3.5 w-3.5" />, color: 'bg-rose-500/15 text-rose-600' },
    transfer: { icon: <ArrowUpRight className="h-3.5 w-3.5" />, color: 'bg-sky-500/15 text-sky-600' },
    escrow: { icon: <Shield className="h-3.5 w-3.5" />, color: 'bg-amber-500/15 text-amber-600' },
    release: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'bg-teal-500/15 text-teal-600' },
  };
  const m = map[type] ?? { icon: <Activity className="h-3.5 w-3.5" />, color: 'bg-muted text-muted-foreground' };
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${m.color}`}>{m.icon}</span>;
}

function MethodIcon({ method }: { method: string }) {
  if (method === 'bank') return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600"><Banknote className="h-3.5 w-3.5" /></span>;
  if (method === 'mobile_money') return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600"><Smartphone className="h-3.5 w-3.5" /></span>;
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600"><Link2 className="h-3.5 w-3.5" /></span>;
}

function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-2">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

// ─── Checkout tab ───────────────────────────────────────────────────────────

function CheckoutTab({ state, onRefresh }: { state: MerchantState; onRefresh: () => void }) {
  const m = state.merchant;
  const [amount, setAmount] = useState('50');
  const [reference, setReference] = useState(`order-${Math.random().toString(36).slice(2, 8)}`);
  const [qrType, setQrType] = useState('dynamic');
  const [qr, setQr] = useState<{ qrId: string; type: string; encoded: string; qrUrl: string; expiresAt: number } | null>(null);
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/merchant/qr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: qrType, merchant: m.id, wallet: `merchant:${m.id}`,
          currency: m.currency, amount: Number(amount), reference, expiresMs: 300000,
        }),
      });
      if (!res.ok) throw new Error('QR failed');
      const data = await res.json();
      setQr(data);
      toast.success('QR generated', { description: `${qrType} · ${fmt(Number(amount), m.currency)}` });
    } catch {
      toast.error('QR generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4 text-emerald-500" />Generate Payment QR</CardTitle>
          <CardDescription className="text-xs">6 QR types · all flow through the kernel pipeline</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label className="text-xs">QR Type</Label>
            <Select value={qrType} onValueChange={setQrType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static (merchant address)</SelectItem>
                <SelectItem value="dynamic">Dynamic (one-time, fixed amount)</SelectItem>
                <SelectItem value="checkout">Checkout (session-based)</SelectItem>
                <SelectItem value="invoice">Invoice (with reference)</SelectItem>
                <SelectItem value="donation">Donation (variable amount)</SelectItem>
                <SelectItem value="subscription">Subscription (recurring)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label className="text-xs">Amount ({m.currency})</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" />
            </div>
          </div>
          <Button onClick={generate} disabled={generating} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <QrCode className="h-4 w-4" />{generating ? 'Generating…' : 'Generate QR'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4 text-teal-500" />QR Preview</CardTitle></CardHeader>
        <CardContent>
          {qr ? (
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-5">
                <QrVisual payload={qr.encoded} />
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums">{fmt(Number(amount), m.currency)}</div>
                  <div className="text-xs text-muted-foreground">{qr.type} · {m.currency}</div>
                </div>
                <div className="w-full space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono">{reference}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">QR ID</span><span className="font-mono">{qr.qrId.slice(0, 24)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span>{qr.expiresAt ? fmtTs(qr.expiresAt) : 'never'}</span></div>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => navigator.clipboard?.writeText(qr.encoded)}>
                  <Copy className="h-3.5 w-3.5" />Copy payload
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState icon={<QrCode className="h-5 w-5" />} title="No QR generated yet" sub="Pick a type and click Generate." />
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-emerald-500" />Hosted Checkout & Payment Links</CardTitle>
          <CardDescription className="text-xs">Embed these in your store or send as links</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckoutLinkCard title="Hosted Checkout" url={`https://pay.payswap.com/checkout/${m.id}`} desc="Redirect customers to a PaySwap-hosted payment page." />
            <CheckoutLinkCard title="Payment Link" url={`https://pay.payswap.com/pay/${m.id}?amount=${amount}&ref=${reference}`} desc="Send a reusable link with amount pre-filled." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QrVisual({ payload }: { payload: string }) {
  // Deterministic pseudo-QR visual (no external QR lib needed)
  const cells = useMemo(() => {
    const size = 21;
    let h = 0;
    for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) >>> 0;
    const out: boolean[] = [];
    for (let i = 0; i < size * size; i++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      out.push((h & 1) === 1);
    }
    // Add finder patterns (corners)
    const setFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
        const onEdge = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        out[(r0 + r) * size + (c0 + c)] = onEdge || inCore;
      }
    };
    setFinder(0, 0); setFinder(0, size - 7); setFinder(size - 7, 0);
    return { size, out };
  }, [payload]);
  const px = 8;
  const dim = cells.size * px;
  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="rounded-lg bg-white p-2" role="img" aria-label="QR code">
      {Array.from({ length: cells.size }).map((_, r) =>
        Array.from({ length: cells.size }).map((_, c) =>
          cells.out[r * cells.size + c] ? (
            <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill="#0a0a0a" />
          ) : null
        )
      )}
    </svg>
  );
}

function CheckoutLinkCard({ title, url, desc }: { title: string; url: string; desc: string }) {
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <div className="flex items-center gap-2 rounded bg-muted/50 p-2">
        <code className="text-[10px] font-mono truncate flex-1">{url}</code>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => navigator.clipboard?.writeText(url)}><Copy className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

// ─── Payouts tab (the new feature) ──────────────────────────────────────────

function PayoutsTab({ state, merchantId, onRefresh }: { state: MerchantState; merchantId: string; onRefresh: () => void }) {
  const m = state.merchant;
  const [method, setMethod] = useState<'bank' | 'mobile_money' | 'onchain'>('bank');
  const [sourceAmount, setSourceAmount] = useState('1000');
  const [destinationCurrency, setDestinationCurrency] = useState(m.currency);
  const [destValue, setDestValue] = useState('');
  const [quote, setQuote] = useState<PayoutQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const quotePayout = async () => {
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote', merchantId, method,
          sourceAsset: `TWIN${m.currency}`, sourceAmount: Number(sourceAmount),
          sourceCurrency: m.currency, destinationCurrency,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? 'quote failed');
      }
      const data = await res.json();
      setQuote(data.quote);
      toast.success('Quote ready', { description: `Net ${fmt(data.quote.netAmount, destinationCurrency)} · fee ${data.quote.feeBps} bps` });
    } catch (e) {
      toast.error('Quote failed', { description: e instanceof Error ? e.message : '' });
    } finally {
      setQuoting(false);
    }
  };

  const requestPayout = async () => {
    if (!quote) return;
    setRequesting(true);
    try {
      // Build destination based on method
      let destination: Payout['destination'];
      if (method === 'bank') destination = { bankAccount: destValue || 'GH0001234567890', accountName: m.name };
      else if (method === 'mobile_money') destination = { phoneNumber: destValue || '+233244555000', accountName: m.name };
      else destination = { walletAddress: destValue || 'GDEMOEXTERNALWALLETADDRESS0000000000000000000000000' };

      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request', merchantId, method,
          sourceAsset: quote.sourceAsset, sourceAmount: quote.sourceAmount,
          sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency,
          destination,
        }),
      });
      if (!res.ok) throw new Error('request failed');
      const { payout } = await res.json();
      toast.success('Payout requested', { description: `${payout.id.slice(0, 20)} — processing…` });

      // Auto-process immediately (in production this would be async)
      const procRes = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process', payoutId: payout.id }),
      });
      const procData = await procRes.json();
      if (procData.payout.state === 'completed') {
        toast.success('Payout completed', { description: `${fmt(procData.payout.netAmount, procData.payout.destinationCurrency)} · ${procData.payout.txHash?.slice(0, 16)}` });
      } else {
        toast.error('Payout failed', { description: procData.payout.reason });
      }
      setQuote(null);
      setDestValue('');
      onRefresh();
    } catch (e) {
      toast.error('Payout failed', { description: e instanceof Error ? e.message : '' });
    } finally {
      setRequesting(false);
    }
  };

  const stats = state.payoutStats;

  return (
    <>
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Payouts" value={String(stats.total)} sub={`${stats.completed} completed · ${stats.failed} failed`} icon={<ArrowDownToLine className="h-4 w-4" />} accent="emerald" />
        <KpiCard label="Volume Withdrawn" value={fmt(stats.totalVolume, m.currency)} sub={`${stats.totalFees} fees`} icon={<TrendingUp className="h-4 w-4" />} accent="teal" />
        <KpiCard label="Bank Payouts" value={String(stats.byMethod.bank)} sub="Open Banking connector" icon={<Banknote className="h-4 w-4" />} accent="emerald" />
        <KpiCard label="On-chain Payouts" value={String(stats.byMethod.onchain)} sub="Stellar transfers" icon={<Link2 className="h-4 w-4" />} accent="teal" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Request form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4 text-emerald-500" />Withdraw Funds</CardTitle>
            <CardDescription className="text-xs">Convert Twin Tokens to fiat or on-chain wallet · burns {`TWIN${m.currency}`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Available balance</span><span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(state.twinToken.available, m.currency)}</span></div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Payout Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['bank', 'mobile_money', 'onchain'] as const).map((mt) => (
                  <button key={mt} onClick={() => setMethod(mt)}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] transition-colors ${method === mt ? 'border-emerald-500 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'hover:bg-muted/50'}`}>
                    {mt === 'bank' ? <Banknote className="h-4 w-4" /> : mt === 'mobile_money' ? <Smartphone className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    <span className="font-medium">{mt === 'bank' ? 'Bank' : mt === 'mobile_money' ? 'Mobile' : 'On-chain'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label className="text-xs">Amount ({`TWIN${m.currency}`})</Label>
                <Input type="number" value={sourceAmount} onChange={(e) => setSourceAmount(e.target.value)} className="h-9" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Destination Currency</Label>
                <Select value={destinationCurrency} onValueChange={setDestinationCurrency}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(CCY).map((c) => <SelectItem key={c} value={c}>{c} {ccy(c).flag}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">
                {method === 'bank' ? 'Bank Account IBAN' : method === 'mobile_money' ? 'Phone Number (M-Pesa)' : 'External Stellar Wallet Address'}
              </Label>
              <Input value={destValue} onChange={(e) => setDestValue(e.target.value)} placeholder={method === 'bank' ? 'GH0001234567890' : method === 'mobile_money' ? '+233244555000' : 'G...'} className="h-9 font-mono text-xs" />
            </div>
            <Button onClick={quotePayout} disabled={quoting} variant="outline" className="w-full gap-2">
              <Zap className="h-4 w-4" />{quoting ? 'Quoting…' : 'Get Quote'}
            </Button>

            {quote && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">FX rate</span><span className="font-mono">1 {quote.sourceCurrency} = {quote.fxRate} {quote.destinationCurrency}</span></div>
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Gross</span><span className="font-semibold tabular-nums">{fmt(quote.sourceAmount * quote.fxRate, quote.destinationCurrency)}</span></div>
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Fee ({quote.feeBps} bps)</span><span className="font-semibold tabular-nums text-rose-600">-{fmt(quote.fee, quote.destinationCurrency)}</span></div>
                <Separator />
                <div className="flex items-center justify-between"><span className="text-sm font-medium">You receive</span><span className="text-lg font-bold tabular-nums text-emerald-600">{fmt(quote.netAmount, quote.destinationCurrency)}</span></div>
                <div className="text-[10px] text-muted-foreground">ETA: ~{Math.round(quote.estimatedSettlementMs / 1000)}s · Evidence: FX attested by exchange_rate connector</div>
                <Button onClick={requestPayout} disabled={requesting} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {requesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                  {requesting ? 'Processing…' : `Withdraw ${fmt(quote.netAmount, quote.destinationCurrency)}`}
                </Button>
              </motion.div>
            )}
          </CardContent>
        </Card>

        {/* Payout history */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-teal-500" />Payout History</CardTitle>
            <CardDescription className="text-xs">All withdrawals with cryptographic evidence</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[28rem]">
              {state.payouts.length === 0 ? (
                <EmptyState icon={<ArrowDownToLine className="h-5 w-5" />} title="No payouts yet" sub="Request your first withdrawal on the left." />
              ) : (
                <div className="space-y-2">
                  {state.payouts.map((p) => (
                    <div key={p.id} className="rounded-lg border p-3 text-xs">
                      <div className="flex items-start gap-3">
                        <MethodIcon method={p.method} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold capitalize">{p.method === 'mobile_money' ? 'Mobile money' : p.method}</span>
                            <Badge variant="outline" className={`h-3.5 px-1 text-[9px] ${PAYOUT_STATE_COLORS[p.state]}`}>{p.state}</Badge>
                          </div>
                          <div className="text-muted-foreground mt-0.5 font-mono text-[10px] truncate">{p.txHash ?? p.id.slice(0, 28)}</div>
                          {p.evidence && <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">✓ evidence: {p.evidence.source} · {p.evidence.verificationLevel}</div>}
                          {p.reason && <div className="text-[10px] text-rose-600 mt-0.5">✗ {p.reason}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold tabular-nums">{fmt(p.netAmount, p.destinationCurrency)}</div>
                          <div className="text-[10px] text-muted-foreground">{p.sourceAmount} {p.sourceAsset}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtTs(p.createdAt)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ─── Catalog tab ────────────────────────────────────────────────────────────

function CatalogTab({ state, merchantId, onRefresh }: { state: MerchantState; merchantId: string; onRefresh: () => void }) {
  const m = state.merchant;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name || !price) { toast.error('Name and price required'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_product', merchantId, name, description, price: Number(price), currency: m.currency }),
      });
      if (!res.ok) throw new Error('create failed');
      toast.success('Product created', { description: `${name} · ${fmt(Number(price), m.currency)}` });
      setName(''); setPrice(''); setDescription('');
      onRefresh();
    } catch {
      toast.error('Failed to create product');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4 text-emerald-500" />New Product</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Single Origin Cocoa" className="h-9" /></div>
          <div className="grid gap-2"><Label className="text-xs">Price ({m.currency})</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="75" className="h-9" /></div>
          <div className="grid gap-2"><Label className="text-xs">Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="500g roasted in Accra" rows={3} className="text-xs" /></div>
          <Button onClick={create} disabled={creating} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4" />{creating ? 'Creating…' : 'Create Product'}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4 text-teal-500" />Products ({state.products.length})</CardTitle></CardHeader>
        <CardContent>
          {state.products.length === 0 ? (
            <EmptyState icon={<Package className="h-5 w-5" />} title="No products" sub="Create your first product on the left." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {state.products.map((p) => (
                <div key={p.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{p.description}</div>
                    </div>
                    <Badge variant="outline" className="h-4 px-1 text-[9px] shrink-0">{p.state}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-bold tabular-nums">{fmt(p.price, p.currency)}</span>
                    <code className="text-[9px] font-mono text-muted-foreground">{p.id.slice(0, 16)}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-emerald-500" />Customers ({state.customers.length})</CardTitle></CardHeader>
        <CardContent>
          {state.customers.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No customers" sub="Customers appear here after their first purchase." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {state.customers.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold">{c.name.charAt(0)}</span>
                    <div className="min-w-0"><div className="font-semibold truncate">{c.name}</div><div className="text-muted-foreground truncate">{c.email}</div></div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">{c.transactionCount} orders</span>
                    <span className="font-semibold tabular-nums">{fmt(c.totalSpent, m.currency)}</span>
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

// ─── API & Webhooks tab ─────────────────────────────────────────────────────

function ApiTab({ state, merchantId, onRefresh }: { state: MerchantState; merchantId: string; onRefresh: () => void }) {
  const [label, setLabel] = useState('Production');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [creatingHook, setCreatingHook] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const createKey = async () => {
    setCreatingKey(true);
    try {
      const res = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_api_key', merchantId, label, scopes: ['payments:write', 'payments:read', 'webhooks:read', 'payouts:write'] }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success('API key created', { description: label });
      onRefresh();
    } catch { toast.error('Failed to create API key'); }
    finally { setCreatingKey(false); }
  };

  const setupHook = async () => {
    if (!webhookUrl) { toast.error('URL required'); return; }
    setCreatingHook(true);
    try {
      const res = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup_webhook', merchantId, url: webhookUrl }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success('Webhook registered', { description: webhookUrl });
      setWebhookUrl('');
      onRefresh();
    } catch { toast.error('Failed to register webhook'); }
    finally { setCreatingHook(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-emerald-500" />API Keys</CardTitle>
            <CardDescription className="text-xs">psk_live_ keys · HMAC-signed requests</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label" className="h-9" />
              <Button onClick={createKey} disabled={creatingKey} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="h-3.5 w-3.5" />{creatingKey ? '…' : 'New'}
              </Button>
            </div>
            <div className="space-y-2">
              {state.apiKeys.length === 0 ? (
                <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No API keys" sub="Create one to start integrating." />
              ) : state.apiKeys.map((k) => (
                <div key={k.id} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{k.label}</span>
                    <Badge variant="outline" className={`h-3.5 px-1 text-[9px] ${k.active ? 'text-emerald-600 border-emerald-500/30' : 'text-zinc-500'}`}>{k.active ? 'active' : 'revoked'}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="font-mono text-[10px] flex-1 truncate bg-muted/50 px-2 py-1 rounded">
                      {revealedKeys.has(k.id) ? k.key : `${k.key.slice(0, 12)}${'•'.repeat(16)}`}
                    </code>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setRevealedKeys((s) => { const n = new Set(s); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n; })}>
                      {revealedKeys.has(k.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => navigator.clipboard?.writeText(k.key)}><Copy className="h-3 w-3" /></Button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {k.scopes.map((s) => <Badge key={s} variant="secondary" className="h-3.5 px-1 text-[9px] font-mono">{s}</Badge>)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">Created {fmtTs(k.createdAt)} · {k.lastUsedAt ? `last used ${fmtTs(k.lastUsedAt)}` : 'never used'}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Webhook className="h-4 w-4 text-teal-500" />Webhook Endpoints</CardTitle>
            <CardDescription className="text-xs">HMAC-SHA256 signed · retry with backoff · idempotent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your.shop/webhooks/payswap" className="h-9 font-mono text-xs" />
              <Button onClick={setupHook} disabled={creatingHook} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
                <Plus className="h-3.5 w-3.5" />{creatingHook ? '…' : 'Add'}
              </Button>
            </div>
            <div className="space-y-2">
              {state.webhooks.endpoints.length === 0 ? (
                <EmptyState icon={<Webhook className="h-5 w-5" />} title="No webhooks" sub="Register a URL to receive payment + payout events." />
              ) : state.webhooks.endpoints.map((ep) => (
                <div key={ep.id} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-[10px] truncate flex-1">{ep.url}</code>
                    <Badge variant="outline" className={`h-3.5 px-1 text-[9px] ${ep.active ? 'text-emerald-600 border-emerald-500/30' : 'text-zinc-500'}`}>{ep.active ? 'active' : 'paused'}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ep.events.map((e) => <Badge key={e} variant="secondary" className="h-3.5 px-1 text-[9px] font-mono">{e}</Badge>)}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">secret:</span>
                    <code className="font-mono text-[10px] bg-muted/50 px-1.5 py-0.5 rounded">{ep.secret}</code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-emerald-500" />Recent Webhook Deliveries</CardTitle>
          <CardDescription className="text-xs">Signed deliveries · exponential backoff retry</CardDescription>
        </CardHeader>
        <CardContent>
          {state.webhooks.deliveries.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="No deliveries yet" sub="Trigger a payment or payout to see webhooks fire." />
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-2">
                {state.webhooks.deliveries.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-xs">
                    <span className={`flex h-2 w-2 rounded-full shrink-0 ${d.status === 'delivered' ? 'bg-emerald-500' : d.status === 'retrying' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                    <code className="font-mono text-[10px] flex-1 truncate">{d.eventType}</code>
                    <Badge variant="outline" className="h-3.5 px-1 text-[9px]">{d.status}</Badge>
                    <span className="text-muted-foreground text-[10px] tabular-nums">{d.attempts}x</span>
                    <span className="text-muted-foreground text-[10px]">{fmtTs(d.timestamp)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Events tab ─────────────────────────────────────────────────────────────

function EventsTab({ state }: { state: MerchantState }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-emerald-500" />Protocol Event Log</CardTitle>
        <CardDescription className="text-xs">Every state change emits an event · {state.events.length} recent events for this merchant</CardDescription>
      </CardHeader>
      <CardContent>
        {state.events.length === 0 ? (
          <EmptyState icon={<GitBranch className="h-5 w-5" />} title="No events yet" sub="Events from merchant.onboarded, payout.*, twintoken.* will appear here." />
        ) : (
          <ScrollArea className="max-h-[32rem]">
            <div className="space-y-1">
              {state.events.map((e) => (
                <div key={e.id} className="flex items-start gap-3 rounded border p-2 text-xs font-mono">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-16">{fmtTs(e.ts)}</span>
                  <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">{String(e.type).split('.')[0]}</Badge>
                  <code className="text-[10px] flex-1 min-w-0 truncate">{e.type}</code>
                  <code className="text-[10px] text-muted-foreground shrink-0 max-w-[40%] truncate">{Object.entries(e.payload).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 16)}`).join(' ')}</code>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
