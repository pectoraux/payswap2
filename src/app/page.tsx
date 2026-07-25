'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/simulator/theme-toggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Activity, ArrowUpRight, ArrowDownRight, Banknote, Building2, Copy, CreditCard,
  Globe, Hash, Layers, Link2, Loader2, Plus, Receipt, RefreshCw, Rocket,
  Settings, ShieldCheck, Smartphone, Sparkles, Store, Ticket, Trash2,
  Wallet, Zap, Cpu, Database, Server, ChevronRight, CheckCircle2, XCircle,
  AlertTriangle, Coins, Users, Boxes, BarChart3, Webhook, KeyRound, Bell,
} from 'lucide-react';

// ============================================================ types
type Tier = 'unverified' | 'verified' | 'trusted' | 'premium';
type MerchantState = 'pending' | 'verified' | 'active' | 'suspended' | 'closed';
type PayoutMethod = 'bank' | 'mobile_money' | 'onchain';
type PayoutState = 'reviewing' | 'processing' | 'completed' | 'failed' | 'cancelled';
type QRType = 'static' | 'dynamic' | 'invoice' | 'donation' | 'subscription' | 'checkout';

interface MerchantAccount {
  id: string;
  name: string;
  email: string;
  country: string;
  currency: string;
  state: MerchantState;
  tier: Tier;
  bond: number;
  bondEscrowed: number;
  createdAt: number;
  settings: any;
  revenue: number;
  transactionCount: number;
  refundVolume: number;
}

interface ApiKey {
  id: string;
  label: string;
  key: string;
  keyPrefix: string;
  scopes: string[];
  active: boolean;
  createdAt: number;
}

interface TeamMember {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedAt: number;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  active: boolean;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  lifetimeValue: number;
  transactionCount: number;
}

interface Invoice {
  id: string;
  number: string;
  total: number;
  currency: string;
  state: string;
  createdAt: number;
}

interface Payout {
  id: string;
  method: PayoutMethod;
  sourceAmount: number;
  sourceCurrency: string;
  destinationAmount: number;
  destinationCurrency: string;
  fee: number;
  netAmount: number;
  state: PayoutState;
  txHash?: string;
  failureReason?: string;
  createdAt: number;
  evidence: any[];
  destination: any;
}

interface PayoutStats {
  total: number;
  byState: Record<PayoutState, number>;
  totalVolume: number;
  totalFees: number;
  totalNet: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

interface TwinTokenBalance {
  assetCode: string;
  currency: string;
  balance: number;
  available: number;
  record: { balance: number; escrowed: number; frozen: boolean };
}

interface TwinTokenOp {
  id: string;
  type: 'mint' | 'burn' | 'transfer' | 'escrow' | 'release';
  assetCode: string;
  amount: number;
  from?: string;
  to?: string;
  txHash?: string;
  ts: number;
}

interface TwinTokenAsset {
  code: string;
  currency: string;
  corridor: string;
  issuer: string;
  totalSupply: number;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
}

interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  responseStatus?: number;
  deliveredAt: number;
  body: string;
}

interface MerchantAnalytics {
  revenue: number;
  transactions: number;
  aov: number;
  refundRate: number;
  refundVolume: number;
  topCustomers: { customerId: string; name: string; lifetimeValue: number; transactionCount: number }[];
  currency: string;
}

interface ProtocolEvent {
  id: string;
  type: string;
  payload: any;
  ts: number;
  frame: number;
}

interface DashboardState {
  merchant: MerchantAccount;
  apiKeys: ApiKey[];
  team: TeamMember[];
  settings: any;
  products: Product[];
  invoices: Invoice[];
  customers: Customer[];
  refunds: any[];
  analytics: MerchantAnalytics;
  twinToken: {
    assets: TwinTokenAsset[];
    balances: TwinTokenBalance[];
    operations: TwinTokenOp[];
  };
  payouts: Payout[];
  payoutStats: PayoutStats;
  webhooks: { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] };
  events: ProtocolEvent[];
}

// ============================================================ helpers
const fmt = (n: number, decimals = 2): string => {
  if (!isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const fmtMoney = (n: number, currency: string): string => {
  const symbols: Record<string, string> = { GHS: 'GH₵', KES: 'KSh', NGN: '₦', USD: '$', ZAR: 'R', UGX: 'USh', TZS: 'TSh' };
  const s = symbols[currency] ?? '';
  return `${s}${fmt(n, 2)}`;
};

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const tierColor = (tier: Tier): string => {
  switch (tier) {
    case 'premium': return 'bg-emerald-500 text-white';
    case 'trusted': return 'bg-teal-500 text-white';
    case 'verified': return 'bg-cyan-500 text-white';
    default: return 'bg-slate-500 text-white';
  }
};

const stateColor = (s: MerchantState | PayoutState | string): string => {
  switch (s) {
    case 'active': case 'completed': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
    case 'verified': case 'processing': return 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30';
    case 'pending': case 'reviewing': case 'draft': case 'sent': return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    case 'suspended': case 'failed': case 'rejected': case 'disputed': return 'bg-rose-500/15 text-rose-500 border-rose-500/30';
    case 'cancelled': case 'void': return 'bg-slate-500/15 text-slate-500 border-slate-500/30';
    case 'paid': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
    default: return 'bg-slate-500/15 text-slate-500 border-slate-500/30';
  }
};

// Deterministic QR-like SVG visual. Hashes the encoded payload into a 21x21 grid.
function qrHash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

const QR_SIZE = 21;

function QrVisual({ payload, size = 200 }: { payload: string; size?: number }) {
  const cells: boolean[] = [];
  let seed = qrHash(payload);
  for (let i = 0; i < QR_SIZE * QR_SIZE; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    cells.push((seed & 0xff) > 128);
  }
  // Force finder patterns at three corners.
  const setFinder = (r0: number, c0: number) => {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        cells[(r0 + dr) * QR_SIZE + (c0 + dc)] = edge || inner;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, QR_SIZE - 7);
  setFinder(QR_SIZE - 7, 0);
  const cell = size / QR_SIZE;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-md bg-white">
      <rect width={size} height={size} fill="white" />
      {cells.map((on, i) => on ? (
        <rect
          key={i}
          x={(i % QR_SIZE) * cell}
          y={Math.floor(i / QR_SIZE) * cell}
          width={cell}
          height={cell}
          fill="#0f766e"
        />
      ) : null)}
    </svg>
  );
}

// ============================================================ subcomponents
function KpiCard({
  label, value, sub, icon: Icon, accent = 'emerald',
}: { label: string; value: string; sub?: string; icon: any; accent?: 'emerald' | 'teal' | 'cyan' | 'amber' | 'rose' }) {
  const accentMap: Record<string, string> = {
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-500',
    teal: 'from-teal-500/20 to-teal-500/5 text-teal-500',
    cyan: 'from-cyan-500/20 to-cyan-500/5 text-cyan-500',
    amber: 'from-amber-500/20 to-amber-500/5 text-amber-500',
    rose: 'from-rose-500/20 to-rose-500/5 text-rose-500',
  };
  return (
    <Card className="overflow-hidden border-emerald-500/10 bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold tracking-tight truncate">{value}</p>
            {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
          </div>
          <div className={`rounded-lg bg-gradient-to-br ${accentMap[accent]} p-2.5`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="rounded-full bg-muted/50 p-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground max-w-xs">{hint}</p> : null}
    </div>
  );
}

function OpIcon({ type }: { type: string }) {
  const map: Record<string, any> = {
    mint: ArrowUpRight, burn: ArrowDownRight, transfer: ArrowRight2, escrow: Lock2, release: Unlock2,
  };
  const Icon = map[type] ?? Activity;
  const colorMap: Record<string, string> = {
    mint: 'text-emerald-500', burn: 'text-rose-500', transfer: 'text-cyan-500',
    escrow: 'text-amber-500', release: 'text-teal-500',
  };
  return <Icon className={`h-4 w-4 ${colorMap[type] ?? 'text-muted-foreground'}`} />;
}

function ArrowRight2(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Lock2(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
    </svg>
  );
}
function Unlock2(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 019.9-1" strokeLinecap="round" />
    </svg>
  );
}

function MethodIcon({ method }: { method: PayoutMethod }) {
  if (method === 'bank') return <Building2 className="h-4 w-4 text-emerald-500" />;
  if (method === 'mobile_money') return <Smartphone className="h-4 w-4 text-teal-500" />;
  return <Globe className="h-4 w-4 text-cyan-500" />;
}

function QrTypeIcon({ type }: { type: QRType }) {
  const map: Record<QRType, any> = {
    static: Link2, dynamic: Zap, invoice: Receipt, donation: Sparkles,
    subscription: RefreshCw, checkout: CreditCard,
  };
  const Icon = map[type] ?? Ticket;
  return <Icon className="h-3.5 w-3.5" />;
}

function CheckoutLinkCard({ title, url, hint }: { title: string; url: string; hint: string }) {
  return (
    <Card className="border-emerald-500/10 bg-card/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="h-4 w-4 text-emerald-500" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 font-mono text-xs truncate" title={url}>
          {url}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            toast.success('Link copied');
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy link
        </Button>
      </CardContent>
    </Card>
  );
}

function ReconRow({ name, passed, metric }: { name: string; passed: boolean; metric?: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {passed
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          : <XCircle className="h-4 w-4 text-rose-500 shrink-0" />}
        <span className="text-sm truncate">{name}</span>
      </div>
      {metric != null ? <Badge variant="outline" className="font-mono text-xs">{metric}</Badge> : null}
    </div>
  );
}

// ============================================================ main page
export default function Home() {
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);

  // ---- bootstrap on first mount
  const fetchState = useCallback(async (id: string) => {
    const res = await fetch(`/api/merchant/state?merchantId=${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `state fetch failed: ${res.status}`);
    }
    return (await res.json()) as DashboardState;
  }, []);

  const bootstrap = useCallback(async (): Promise<string> => {
    setBootstrapping(true);
    try {
      const name = 'Acme Ghana Market';
      const email = 'ops@acme-gh.example';
      const country = 'Ghana';
      const currency = 'GHS';

      const onb = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'onboard', name, email, country, currency }),
      });
      if (!onb.ok) throw new Error('onboard failed');
      const m = (await onb.json()).merchant;
      const id = m.id;

      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', merchantId: id, bond: 5000 }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup_webhook', merchantId: id, url: 'https://demo.acme-gh.example/webhooks/payswap', events: ['payment.created', 'payment.completed', 'payment.failed', 'payment.disputed'] }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_api_key', merchantId: id, label: 'Production API key' }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_product', merchantId: id,
          name: 'Premium Kente Cloth', description: 'Handwoven kente from Bonwire, Ghana.', price: 250, currency: 'GHS',
          metadata: { sku: 'KENTE-001', category: 'textiles' },
        }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_product', merchantId: id,
          name: 'Cocoa Butter Cream', description: 'Raw cocoa butter skincare from the Eastern Region.', price: 45, currency: 'GHS',
          metadata: { sku: 'COCOA-002', category: 'beauty' },
        }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_customer', merchantId: id, name: 'Ama Mensah', email: 'ama@example.com', phone: '+233241234567' }),
      });
      await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_customer', merchantId: id, name: 'Kofi Boateng', email: 'kofi@example.com', phone: '+233205551234' }),
      });

      // Seed 25,000 TWINGHS into the merchant balance.
      const seedRes = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'seed', merchantId: id,
          assetCode: 'TWINGHS', amount: 25000,
          currency: 'GHS', corridor: 'GHANA-RESERVE', issuer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
      });
      if (!seedRes.ok) {
        const err = await seedRes.json().catch(() => ({}));
        toast.error('Seed failed: ' + (err.error ?? seedRes.status));
      } else {
        toast.success('Seeded 25,000 TWINGHS');
      }

      try { localStorage.setItem('payswap_merchant_id', id); } catch {}
      return id;
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let id: string | null = null;
        try { id = localStorage.getItem('payswap_merchant_id'); } catch {}
        if (!id) {
          id = await bootstrap();
        }
        if (cancelled) return;
        setMerchantId(id);
        const s = await fetchState(id);
        if (cancelled) return;
        setState(s);
      } catch (e) {
        toast.error('Bootstrap failed', { description: e instanceof Error ? e.message : 'unknown' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bootstrap, fetchState]);

  const refresh = useCallback(async () => {
    if (!merchantId) return;
    setRefreshing(true);
    try {
      const s = await fetchState(merchantId);
      setState(s);
      toast.success('Dashboard refreshed');
    } catch (e) {
      toast.error('Refresh failed', { description: e instanceof Error ? e.message : 'unknown' });
    } finally {
      setRefreshing(false);
    }
  }, [merchantId, fetchState]);

  const reset = useCallback(async () => {
    try { localStorage.removeItem('payswap_merchant_id'); } catch {}
    setMerchantId(null);
    setState(null);
    setLoading(true);
    const id = await bootstrap();
    setMerchantId(id);
    const s = await fetchState(id);
    setState(s);
    setLoading(false);
    toast.success('Demo merchant re-bootstrapped');
  }, [bootstrap, fetchState]);

  // ===================================================== derived
  const availableBalance = useMemo(() => {
    if (!state) return 0;
    const bal = state.twinToken.balances.find((b) => b.assetCode === `TWIN${state.merchant.currency}`);
    return bal?.available ?? 0;
  }, [state]);

  const totalSupply = useMemo(() => {
    if (!state) return 0;
    return state.twinToken.assets.reduce((s, a) => s + a.totalSupply, 0);
  }, [state]);

  const payoutVolume = useMemo(() => state?.payoutStats.totalVolume ?? 0, [state]);

  // ===================================================== render
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-950/5">
      {/* sticky header */}
      <header className="sticky top-0 z-40 border-b border-emerald-500/10 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20">
              <Store className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold truncate">
                  {state?.merchant.name ?? (bootstrapping ? 'Bootstrapping merchant…' : 'PaySwap Merchant')}
                </h1>
                {state?.merchant ? (
                  <Badge className={`${tierColor(state.merchant.tier)} text-[10px] uppercase`}>{state.merchant.tier}</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {state?.merchant ? `${state.merchant.country} · ${state.merchant.currency}` : 'Loading dashboard…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Available</span>
              <span className="text-sm font-semibold text-emerald-500">
                {fmtMoney(availableBalance, state?.merchant.currency ?? 'GHS')}
              </span>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={refresh}
              disabled={refreshing || !merchantId}
              className="border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={reset}
              disabled={bootstrapping}
              title="Reset demo merchant"
            >
              {bootstrapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Reset</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 pb-24">
        {loading || !state ? (
          <LoadingDashboard />
        ) : (
          <>
            {/* hero card */}
            <HeroCard state={state} availableBalance={availableBalance} />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
              <ScrollArea className="w-full whitespace-nowrap">
                <TabsList className="bg-card/40 border border-emerald-500/10">
                  <TabsTrigger value="overview"><BarChart3 className="h-3.5 w-3.5" /> Overview</TabsTrigger>
                  <TabsTrigger value="checkout"><CreditCard className="h-3.5 w-3.5" /> Checkout</TabsTrigger>
                  <TabsTrigger value="payouts"><Banknote className="h-3.5 w-3.5" /> Payouts</TabsTrigger>
                  <TabsTrigger value="catalog"><Boxes className="h-3.5 w-3.5" /> Catalog</TabsTrigger>
                  <TabsTrigger value="api"><Webhook className="h-3.5 w-3.5" /> API & Webhooks</TabsTrigger>
                  <TabsTrigger value="events"><Activity className="h-3.5 w-3.5" /> Events</TabsTrigger>
                  <TabsTrigger value="infra"><Server className="h-3.5 w-3.5" /> Infra</TabsTrigger>
                </TabsList>
              </ScrollArea>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                  className="mt-4"
                >
                  {activeTab === 'overview' && <OverviewTab state={state} availableBalance={availableBalance} totalSupply={totalSupply} payoutVolume={payoutVolume} />}
                  {activeTab === 'checkout' && <CheckoutTab state={state} />}
                  {activeTab === 'payouts' && <PayoutsTab state={state} merchantId={merchantId!} onChanged={refresh} />}
                  {activeTab === 'catalog' && <CatalogTab state={state} merchantId={merchantId!} onChanged={refresh} />}
                  {activeTab === 'api' && <ApiTab state={state} />}
                  {activeTab === 'events' && <EventsTab state={state} />}
                  {activeTab === 'infra' && <InfraTab />}
                </motion.div>
              </AnimatePresence>
            </Tabs>
          </>
        )}
      </main>

      {/* sticky footer */}
      <footer className="sticky bottom-0 z-30 border-t border-emerald-500/10 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto max-w-7xl px-4 py-2 flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>PaySwap Merchant Platform · protocol-layer</span>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> kernel frozen</span>
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> bond escrowed</span>
            <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> {state?.merchant.id?.slice(0, 14) ?? '—'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================ hero
function HeroCard({ state, availableBalance }: { state: DashboardState; availableBalance: number }) {
  const m = state.merchant;
  return (
    <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 via-card to-teal-950/20">
      <CardContent className="p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2 space-y-2">
            <div className="flex items-center gap-2">
              <Badge className={`${tierColor(m.tier)} text-[10px] uppercase`}>{m.tier}</Badge>
              <Badge variant="outline" className={`${stateColor(m.state)} text-[10px] uppercase`}>{m.state}</Badge>
              <Badge variant="outline" className="text-[10px] uppercase">{m.country}</Badge>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{m.name}</h2>
            <p className="text-sm text-muted-foreground">{m.email}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Bond {fmtMoney(m.bondEscrowed, m.currency)}</span>
              <span className="flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> {m.id.slice(0, 18)}</span>
              <span className="flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {fmtMoney(availableBalance, m.currency)} available</span>
            </div>
          </div>
          <HeroStat label="Revenue" value={fmtMoney(state.analytics.revenue, m.currency)} icon={BarChart3} />
          <HeroStat label="Transactions" value={fmt(state.analytics.transactions, 0)} icon={Activity} />
          <HeroStat label="Payouts" value={fmt(state.payoutStats.total, 0)} icon={Banknote} />
          <HeroStat label="Avg Order" value={fmtMoney(state.analytics.aov, m.currency)} icon={Receipt} />
        </div>
      </CardContent>
    </Card>
  );
}

function HeroStat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-xl border border-emerald-500/15 bg-card/60 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-emerald-500/70" />
      </div>
      <p className="text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

// ============================================================ overview tab
function OverviewTab({ state, availableBalance, totalSupply, payoutVolume }: {
  state: DashboardState; availableBalance: number; totalSupply: number; payoutVolume: number;
}) {
  const m = state.merchant;
  const recentOps = state.twinToken.operations.slice(-8).reverse();
  const recentPayouts = state.payouts.slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard label="Revenue" value={fmtMoney(state.analytics.revenue, m.currency)} sub={`${state.analytics.transactions} txns`} icon={BarChart3} accent="emerald" />
        <KpiCard label="Avg Order Value" value={fmtMoney(state.analytics.aov, m.currency)} sub={`Refund rate ${(state.analytics.refundRate * 100).toFixed(1)}%`} icon={Receipt} accent="teal" />
        <KpiCard label="Twin Token Supply" value={fmt(totalSupply, 2)} sub={`${state.twinToken.assets.length} asset(s)`} icon={Coins} accent="cyan" />
        <KpiCard label="Payout Volume" value={fmtMoney(payoutVolume, m.currency)} sub={`${state.payoutStats.total} payouts`} icon={Banknote} accent="amber" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Twin Token balance card */}
        <Card className="md:col-span-1 border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Coins className="h-4 w-4 text-emerald-500" /> Twin Token Balance</CardTitle>
            <CardDescription className="text-xs">Holder key <code className="text-emerald-500">{`merchant:${m.id.slice(0, 12)}`}</code></CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {state.twinToken.balances.length === 0 ? (
              <EmptyState icon={Coins} title="No balances yet" hint="Seed a payout to mint tokens." />
            ) : state.twinToken.balances.map((b) => (
              <div key={b.assetCode} className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-emerald-500">{b.assetCode}</span>
                  <Badge variant="outline" className="text-[10px]">{b.currency}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Balance</p>
                    <p className="font-semibold">{fmt(b.balance, 2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Available</p>
                    <p className="font-semibold text-emerald-500">{fmt(b.available, 2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Escrowed</p>
                    <p className="font-semibold">{fmt(b.record.escrowed, 2)}</p>
                  </div>
                </div>
                {b.record.frozen ? <Badge variant="destructive" className="text-[10px]">FROZEN</Badge> : null}
              </div>
            ))}
            <div className="pt-2 space-y-1 text-xs text-muted-foreground">
              <p className="flex items-center justify-between"><span>Available balance</span><span className="font-semibold text-emerald-500">{fmtMoney(availableBalance, m.currency)}</span></p>
              <p className="flex items-center justify-between"><span>Issued supply</span><span>{fmt(totalSupply, 2)}</span></p>
            </div>
          </CardContent>
        </Card>

        {/* Recent token operations */}
        <Card className="md:col-span-2 border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-teal-500" /> Recent Token Operations</CardTitle>
            <CardDescription className="text-xs">Last 8 mint / burn / transfer / escrow operations on this merchant's holder.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentOps.length === 0 ? (
              <EmptyState icon={Activity} title="No operations yet" hint="Seed or withdraw to see activity." />
            ) : (
              <div className="space-y-1">
                {recentOps.map((op) => (
                  <div key={op.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <OpIcon type={op.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        <span className="uppercase text-xs text-muted-foreground">{op.type}</span>
                        <span className="ml-2 font-mono">{fmt(op.amount, 2)} {op.assetCode}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {op.from ? `from ${op.from.slice(0, 18)} ` : ''}{op.to ? `→ ${op.to.slice(0, 18)}` : ''}
                        {op.txHash ? ` · ${op.txHash.slice(0, 14)}` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtTime(op.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top customers */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-cyan-500" /> Top Customers</CardTitle>
            <CardDescription className="text-xs">By lifetime value.</CardDescription>
          </CardHeader>
          <CardContent>
            {state.analytics.topCustomers.length === 0 ? (
              <EmptyState icon={Users} title="No customers yet" hint="Create a customer from the Catalog tab." />
            ) : (
              <div className="space-y-1">
                {state.analytics.topCustomers.map((c, i) => (
                  <div key={c.customerId} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-[11px] font-semibold text-emerald-500">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.transactionCount} txn(s)</p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-500">{fmtMoney(c.lifetimeValue, m.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent payouts */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Banknote className="h-4 w-4 text-amber-500" /> Recent Payouts</CardTitle>
            <CardDescription className="text-xs">Latest withdrawal activity.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPayouts.length === 0 ? (
              <EmptyState icon={Banknote} title="No payouts yet" hint="Request a withdrawal from the Payouts tab." />
            ) : (
              <div className="space-y-1">
                {recentPayouts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <MethodIcon method={p.method} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {fmtMoney(p.destinationAmount, p.destinationCurrency)}
                        <span className="ml-2 text-[11px] text-muted-foreground">{p.method}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{p.id.slice(0, 18)}</p>
                    </div>
                    <Badge variant="outline" className={`${stateColor(p.state)} text-[10px] uppercase`}>{p.state}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================ checkout tab
function CheckoutTab({ state }: { state: DashboardState }) {
  const m = state.merchant;
  const [qrType, setQrType] = useState<QRType>('dynamic');
  const [amount, setAmount] = useState('100');
  const [reference, setReference] = useState('');
  const [interval, setInterval2] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [generated, setGenerated] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const wallet = `wallet:${m.id.slice(0, 8)}`;
      const body: any = {
        type: qrType, merchant: m.id, wallet: m.currency, currency: m.currency,
        amount: amount ? Number(amount) : undefined, reference: reference || undefined,
      };
      if (qrType === 'static' || qrType === 'donation') delete body.amount;
      if (qrType === 'subscription') body.interval = interval;
      if (qrType === 'invoice' && !reference) body.reference = `INV-${Date.now().toString().slice(-6)}`;
      const res = await fetch('/api/merchant/qr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('QR generation failed', { description: data.error ?? res.status });
        return;
      }
      setGenerated(data.qr);
      toast.success(`Generated ${qrType} QR`);
    } finally {
      setBusy(false);
    }
  };

  const hostedUrl = `https://checkout.payswap.io/${m.id}/${generated?.id ?? 'preview'}`;
  const linkUrl = `https://pay.payswap.io/p/${m.id}/${generated?.id ?? 'preview'}`;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1 border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Ticket className="h-4 w-4 text-emerald-500" /> Generate QR</CardTitle>
          <CardDescription className="text-xs">Choose one of six QR types covering the full merchant surface.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">QR type</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['static', 'dynamic', 'invoice', 'donation', 'subscription', 'checkout'] as QRType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setQrType(t)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    qrType === t
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <QrTypeIcon type={t} /> {t}
                </button>
              ))}
            </div>
          </div>
          {(qrType !== 'static' && qrType !== 'donation') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Amount ({m.currency})</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="order-1234" />
          </div>
          {qrType === 'subscription' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Interval</Label>
              <Select value={interval} onValueChange={(v: any) => setInterval2(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={handleGenerate}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Generate {qrType} QR
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Static + donation QRs are open-amount with no expiry. Dynamic + checkout expire after 5–10 minutes. Invoice QRs are valid for 24h.
          </p>
        </CardContent>
      </Card>

      <div className="lg:col-span-2 grid gap-4">
        <Card className="border-emerald-500/15">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Ticket className="h-4 w-4 text-emerald-500" /> QR Visual</CardTitle>
            <CardDescription className="text-xs">Deterministic SVG rendered from the encoded payload hash.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {generated ? (
              <>
                <div className="rounded-xl border border-emerald-500/15 bg-white p-3">
                  <QrVisual payload={generated.encoded} size={220} />
                </div>
                <div className="w-full space-y-1 text-xs">
                  <Row label="ID" value={generated.id} />
                  <Row label="Type" value={generated.type} />
                  <Row label="Currency" value={generated.currency} />
                  {generated.amount != null && <Row label="Amount" value={fmtMoney(generated.amount, generated.currency)} />}
                  {generated.reference && <Row label="Reference" value={generated.reference} />}
                  {generated.interval && <Row label="Interval" value={generated.interval} />}
                  <Row label="Expires" value={generated.expiresAt ? fmtDate(generated.expiresAt) : 'never'} />
                  <div className="pt-1">
                    <p className="text-muted-foreground">Encoded payload</p>
                    <code className="block w-full break-all rounded bg-muted/40 p-2 text-[10px] font-mono">{generated.encoded}</code>
                  </div>
                </div>
                <Button
                  variant="outline" size="sm"
                  className="border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                  onClick={() => { navigator.clipboard?.writeText(generated.encoded); toast.success('Payload copied'); }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy payload
                </Button>
              </>
            ) : (
              <EmptyState icon={Ticket} title="No QR generated yet" hint="Pick a type and click Generate." />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckoutLinkCard title="Hosted Checkout" url={hostedUrl} hint="Drop-in hosted checkout page for online stores. Pass the QR id as a query param to pre-fill the cart." />
          <CheckoutLinkCard title="Payment Link" url={linkUrl} hint="Reusable payment link you can text or email to a customer. Works on mobile and desktop." />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs truncate">{value}</span>
    </div>
  );
}

// ============================================================ payouts tab
function PayoutsTab({ state, merchantId, onChanged }: { state: DashboardState; merchantId: string; onChanged: () => void }) {
  const m = state.merchant;
  const [method, setMethod] = useState<PayoutMethod>('bank');
  const [amount, setAmount] = useState('1000');
  const [currency, setCurrency] = useState(m.currency);
  const [destinationCurrency, setDestinationCurrency] = useState(m.currency);
  const [destinationInput, setDestinationInput] = useState('');
  const [quote, setQuote] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const quoteRequest = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote', merchantId,
          method, sourceAsset: `TWIN${currency}`,
          sourceAmount: Number(amount), sourceCurrency: currency,
          destinationCurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Quote failed', { description: data.error }); return; }
      setQuote(data.quote);
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      const destination: any = { method };
      if (method === 'bank') { destination.accountNumber = destinationInput || '0123456789'; destination.accountName = m.name; destination.bankCode = 'GH060100'; destination.country = m.country; }
      if (method === 'mobile_money') { destination.msisdn = destinationInput || '+233241234567'; destination.country = m.country; }
      if (method === 'onchain') { destination.chain = 'stellar'; destination.address = destinationInput || 'GDEMO_DESTINATION_WALLET_ADDRESS'; }
      const reqRes = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request', merchantId,
          method, sourceAsset: `TWIN${currency}`,
          sourceAmount: Number(amount), sourceCurrency: currency,
          destinationCurrency, destination, note: 'merchant withdrawal',
        }),
      });
      const reqData = await reqRes.json();
      if (!reqRes.ok) { toast.error('Payout request failed', { description: reqData.error }); return; }
      const payoutId = reqData.payout.id;
      toast.success('Payout requested — processing…');
      const procRes = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process', payoutId }),
      });
      const procData = await procRes.json();
      if (!procRes.ok) { toast.error('Payout processing failed', { description: procData.error }); return; }
      const finalState = procData.payout.state;
      if (finalState === 'completed') toast.success('Payout completed', { description: `tx ${procData.payout.txHash?.slice(0, 18) ?? ''}` });
      else toast.error(`Payout ${finalState}`, { description: procData.payout.failureReason ?? '' });
      onChanged();
    } finally { setBusy(false); }
  };

  const stats = state.payoutStats;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <KpiCard label="Total Payouts" value={fmt(stats.total, 0)} sub={`${stats.completedCount} completed`} icon={Banknote} accent="emerald" />
        <KpiCard label="Volume" value={fmtMoney(stats.totalVolume, m.currency)} icon={Activity} accent="teal" />
        <KpiCard label="Fees Earned" value={fmtMoney(stats.totalFees, m.currency)} icon={Coins} accent="cyan" />
        <KpiCard label="Net Disbursed" value={fmtMoney(stats.totalNet, m.currency)} icon={ArrowDownRight} accent="amber" />
        <KpiCard label="Pending" value={fmt(stats.pendingCount, 0)} sub={`${stats.failedCount} failed`} icon={AlertTriangle} accent="rose" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1 border-emerald-500/15">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-500" /> Withdraw Funds</CardTitle>
            <CardDescription className="text-xs">Burn or transfer TWIN tokens to an external rail.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={(v: any) => setMethod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank"><span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" /> Bank · 50 bps · 1 day</span></SelectItem>
                  <SelectItem value="mobile_money"><span className="flex items-center gap-2"><Smartphone className="h-3.5 w-3.5" /> Mobile Money · 75 bps · 1 min</span></SelectItem>
                  <SelectItem value="onchain"><span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Onchain · 10 bps · 5 sec</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Source amount</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Source ccy</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['GHS', 'KES', 'NGN', 'USD', 'ZAR'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Destination currency</Label>
              <Select value={destinationCurrency} onValueChange={setDestinationCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['GHS', 'KES', 'NGN', 'USD', 'ZAR'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {method === 'bank' ? 'Bank account number' : method === 'mobile_money' ? 'MSISDN' : 'Wallet address'}
              </Label>
              <Input value={destinationInput} onChange={(e) => setDestinationInput(e.target.value)} placeholder={method === 'bank' ? '0123456789' : method === 'mobile_money' ? '+233241234567' : 'GDEMO…'} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10" onClick={quoteRequest} disabled={busy}>
                Quote
              </Button>
              <Button className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={withdraw} disabled={busy || !amount}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-emerald-500/15">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4 text-teal-500" /> Quote Preview</CardTitle>
            <CardDescription className="text-xs">Quote breakdown for the current withdrawal parameters.</CardDescription>
          </CardHeader>
          <CardContent>
            {quote ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <QuoteStat label="Source amount" value={`${fmt(quote.sourceAmount, 2)} ${quote.sourceCurrency}`} />
                <QuoteStat label="Fee (bps)" value={`${fmt(quote.fee, 2)} ${quote.sourceCurrency} · ${quote.feeBps} bps`} />
                <QuoteStat label="Net amount" value={`${fmt(quote.netAmount, 2)} ${quote.sourceCurrency}`} />
                <QuoteStat label="FX rate" value={fmt(quote.fxRate, 4)} />
                <QuoteStat label="Destination amount" value={`${fmt(quote.destinationAmount, 2)} ${quote.destinationCurrency}`} />
                <QuoteStat label="ETA" value={quote.estimatedSettlementMs >= 3_600_000 ? `${Math.round(quote.estimatedSettlementMs / 3_600_000)}h` : `${Math.round(quote.estimatedSettlementMs / 1000)}s`} />
                <QuoteStat label="Available balance" value={`${fmt(quote.availableBalance, 2)} ${quote.sourceCurrency}`} highlight />
                <QuoteStat label="Quoted at" value={fmtTime(quote.quotedAt)} />
              </div>
            ) : (
              <EmptyState icon={Receipt} title="No quote yet" hint="Set the parameters and click Quote." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-500" /> Payout History</CardTitle>
          <CardDescription className="text-xs">Every withdrawal with evidence + tx hash + final state.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.payouts.length === 0 ? (
            <EmptyState icon={Banknote} title="No payouts yet" hint="Submit your first withdrawal above." />
          ) : (
            <div className="space-y-1">
              {state.payouts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <MethodIcon method={p.method} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {fmtMoney(p.destinationAmount, p.destinationCurrency)}
                      <span className="ml-2 text-xs text-muted-foreground">{p.method} · {fmtMoney(p.sourceAmount, p.sourceCurrency)} → {p.destinationCurrency}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {p.id} · fee {fmt(p.fee, 2)} {p.sourceCurrency} · net {fmt(p.netAmount, 2)}
                      {p.txHash ? ` · tx ${p.txHash.slice(0, 16)}` : ''}
                      {p.evidence?.length ? ` · ${p.evidence.length} evidence` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className={`${stateColor(p.state)} text-[10px] uppercase`}>{p.state}</Badge>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{fmtRelative(p.createdAt)}</p>
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

function QuoteStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/50 bg-card/40'}`}>
      <p className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? 'text-emerald-500' : ''}`}>{value}</p>
    </div>
  );
}

// ============================================================ catalog tab
function CatalogTab({ state, merchantId, onChanged }: { state: DashboardState; merchantId: string; onChanged: () => void }) {
  const m = state.merchant;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const createProduct = async () => {
    if (!name || !price) { toast.error('Name and price are required'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/merchant/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_product', merchantId, name, description, price: Number(price), currency: m.currency }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Create failed', { description: data.error }); return; }
      toast.success('Product created');
      setName(''); setDescription(''); setPrice('');
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1 border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-500" /> New Product</CardTitle>
          <CardDescription className="text-xs">Add an item to your merchant catalog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Premium Kente Cloth" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Handwoven kente from Bonwire, Ghana." />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Price ({m.currency})</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="250" />
          </div>
          <Button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white" onClick={createProduct} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add product
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4 text-teal-500" /> Products ({state.products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {state.products.length === 0 ? (
            <EmptyState icon={Boxes} title="No products yet" hint="Create your first product on the left." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {state.products.map((p) => (
                <div key={p.id} className="rounded-lg border border-emerald-500/15 bg-card/50 p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    <Badge className="bg-emerald-500/15 text-emerald-500 text-[10px]">{fmtMoney(p.price, p.currency)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.description || 'No description'}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{p.id}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3 border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-cyan-500" /> Customers ({state.customers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {state.customers.length === 0 ? (
            <EmptyState icon={Users} title="No customers yet" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {state.customers.map((c) => (
                <div key={c.id} className="rounded-lg border border-emerald-500/15 bg-card/50 p-3 space-y-1">
                  <p className="font-medium text-sm truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  {c.phone ? <p className="text-[11px] text-muted-foreground">{c.phone}</p> : null}
                  <Separator className="my-1.5 bg-emerald-500/10" />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{c.transactionCount} txn(s)</span>
                    <span className="font-semibold text-emerald-500">{fmtMoney(c.lifetimeValue, m.currency)}</span>
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

// ============================================================ api tab
function ApiTab({ state }: { state: DashboardState }) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-500" /> API Keys</CardTitle>
          <CardDescription className="text-xs">Live credentials with scoped permissions. Keys are shown once on creation.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.apiKeys.length === 0 ? (
            <EmptyState icon={KeyRound} title="No API keys" />
          ) : (
            <div className="space-y-2">
              {state.apiKeys.map((k) => (
                <div key={k.id} className="rounded-lg border border-emerald-500/15 bg-card/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{k.label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{k.id}</p>
                    </div>
                    <Badge variant={k.active ? 'default' : 'destructive'} className={`text-[10px] ${k.active ? 'bg-emerald-500/15 text-emerald-500' : ''}`}>
                      {k.active ? 'active' : 'revoked'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted/40 px-2 py-1 text-[11px] font-mono truncate">
                      {revealed[k.id] ? k.key : k.keyPrefix}
                    </code>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))}>
                      {revealed[k.id] ? <XCircle className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { navigator.clipboard?.writeText(k.key); toast.success('Key copied'); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-500">{s}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4 text-teal-500" /> Webhook Endpoints</CardTitle>
          <CardDescription className="text-xs">HMAC-signed event delivery endpoints for this merchant.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.webhooks.endpoints.length === 0 ? (
            <EmptyState icon={Webhook} title="No webhooks configured" />
          ) : (
            <div className="space-y-2">
              {state.webhooks.endpoints.map((ep) => (
                <div key={ep.id} className="rounded-lg border border-emerald-500/15 bg-card/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-mono truncate flex-1">{ep.url}</code>
                    <Badge variant={ep.active ? 'default' : 'destructive'} className={`text-[10px] ${ep.active ? 'bg-emerald-500/15 text-emerald-500' : ''}`}>
                      {ep.active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase text-muted-foreground">Secret</span>
                    <code className="flex-1 rounded bg-muted/40 px-2 py-1 text-[10px] font-mono truncate">{ep.secret}</code>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { navigator.clipboard?.writeText(ep.secret); toast.success('Secret copied'); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ep.events.map((e) => (
                      <Badge key={e} variant="outline" className="text-[10px] font-mono border-teal-500/30 text-teal-500">{e}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 border-emerald-500/15">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-cyan-500" /> Webhook Deliveries ({state.webhooks.deliveries.length})</CardTitle>
          <CardDescription className="text-xs">Signed deliveries dispatched to merchant endpoints.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.webhooks.deliveries.length === 0 ? (
            <EmptyState icon={Bell} title="No deliveries yet" hint="Trigger a payout or payment to fire webhooks." />
          ) : (
            <ScrollArea className="h-72">
              <div className="space-y-1 pr-2">
                {state.webhooks.deliveries.slice().reverse().map((d) => (
                  <div key={d.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <Badge variant="outline" className={`text-[10px] font-mono ${d.status === 'delivered' ? 'border-emerald-500/30 text-emerald-500' : 'border-rose-500/30 text-rose-500'}`}>
                      {d.responseStatus ?? d.status}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{d.eventType}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{d.body.slice(0, 120)}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{fmtTime(d.deliveredAt)}</span>
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

// ============================================================ events tab
function EventsTab({ state }: { state: DashboardState }) {
  return (
    <Card className="border-emerald-500/15">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-500" /> Protocol Event Log</CardTitle>
        <CardDescription className="text-xs">Merchant-filtered stream from the kernel event engine.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.events.length === 0 ? (
          <EmptyState icon={Activity} title="No events yet" hint="Trigger activity to populate the log." />
        ) : (
          <ScrollArea className="h-[600px]">
            <div className="space-y-1 pr-2">
              {state.events.map((e) => (
                <div key={e.id} className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
                  <span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono">
                      <span className="text-emerald-500">{e.type}</span>
                      <span className="ml-2 text-muted-foreground">frame {e.frame}</span>
                    </p>
                    <code className="block text-[10px] text-muted-foreground truncate">{JSON.stringify(e.payload).slice(0, 200)}</code>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(e.ts)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================ infra tab
function InfraTab() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [health, trial, recon, treasury, resilience] = await Promise.all([
        fetch('/api/ops/health').then((r) => r.json()).catch(() => null),
        fetch('/api/ledger/trial-balance').then((r) => r.json()).catch(() => null),
        fetch('/api/ledger/reconciliation').then((r) => r.json()).catch(() => null),
        fetch('/api/treasury/status').then((r) => r.json()).catch(() => null),
        fetch('/api/resilience/health').then((r) => r.json()).catch(() => null),
      ]);
      setData({ health, trial, recon, treasury, resilience });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-emerald-500/15"><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const { health, trial, recon, treasury, resilience } = data;
  const tb = trial?.trialBalance;
  const report = recon?.report;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* System health */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4 text-emerald-500" /> System Health</CardTitle>
            <CardDescription className="text-xs">{health?.kernelVersion ?? '—'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge className={`${health?.status === 'online' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'} text-[10px] uppercase`}>{health?.status ?? 'unknown'}</Badge>
            </div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Engines</span><span>{health?.engineSummary?.online ?? 0}/{health?.engineSummary?.total ?? 0} online</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Merchants</span><span>{health?.counts?.merchants ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Payouts</span><span>{health?.counts?.payouts ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Events emitted</span><span>{health?.counts?.events ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Twin supply</span><span className="font-mono text-xs">{fmt(health?.counts?.twinSupply ?? 0, 2)}</span></div>
          </CardContent>
        </Card>

        {/* Trial balance */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-teal-500" /> Trial Balance</CardTitle>
            <CardDescription className="text-xs">Protocol ledger double-entry integrity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Balanced</span>
              <Badge variant="outline" className={`${tb?.balanced ? 'border-emerald-500/30 text-emerald-500' : 'border-rose-500/30 text-rose-500'} text-[10px]`}>
                {tb?.balanced ? 'YES' : 'NO'}
              </Badge>
            </div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Total debits</span><span className="font-mono text-xs">{fmt(tb?.totalDebits ?? 0, 2)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Total credits</span><span className="font-mono text-xs">{fmt(tb?.totalCredits ?? 0, 2)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Journals</span><span>{trial?.journals ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Legs</span><span>{trial?.legs ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Active accounts</span><span>{trial?.activeAccounts?.length ?? 0}</span></div>
          </CardContent>
        </Card>

        {/* Reconciliation */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-500" /> Reconciliation</CardTitle>
            <CardDescription className="text-xs">Daily close-pack checks.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              <ReconRow name="twinTokenBacking" passed={!!recon?.twinTokenBacking?.passed} metric={`${recon?.twinTokenBacking?.discrepancies?.length ?? 0} diff`} />
              <ReconRow name="escrow" passed={!!report?.escrow?.passed} metric={`${report?.escrow?.metrics?.frozenCount ?? 0} frozen`} />
              <ReconRow name="payouts" passed={!!report?.payouts?.passed} metric={`${report?.payouts?.metrics?.completedCount ?? 0} done`} />
              <ReconRow name="treasury" passed={!!recon?.treasury?.passed} metric={recon?.treasury?.metrics?.balanced === 1 ? 'balanced' : 'unbalanced'} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Overall</span>
              <Badge variant="outline" className={`${report?.passed ? 'border-emerald-500/30 text-emerald-500' : 'border-rose-500/30 text-rose-500'} text-[10px] uppercase`}>
                {report?.passed ? 'PASSED' : `${report?.failedCount ?? 0} FAILED`}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Treasury */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Coins className="h-4 w-4 text-amber-500" /> Treasury</CardTitle>
            <CardDescription className="text-xs">Reserve positions + recommendations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Positions</span><span>{treasury?.positionCount ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Total reserves</span><span className="font-mono text-xs">{fmt(treasury?.totalReserves ?? 0, 2)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Pending recs</span><span>{treasury?.pendingCount ?? 0}</span></div>
            <Separator className="my-1 bg-emerald-500/10" />
            {(treasury?.positions ?? []).slice(0, 3).map((p: any) => (
              <div key={p.currency} className="flex items-center justify-between text-xs">
                <span className="font-mono text-muted-foreground">{p.currency}</span>
                <span>{fmt(p.totalReserves, 2)} <span className="text-muted-foreground">({fmt(p.fiatBalance, 0)} fiat)</span></span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Circuit breakers */}
        <Card className="md:col-span-2 border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4 text-emerald-500" /> Circuit Breakers</CardTitle>
            <CardDescription className="text-xs">{resilience?.summary?.total ?? 0} breakers · {resilience?.summary?.open ?? 0} open · {resilience?.summary?.halfOpen ?? 0} half-open · {resilience?.summary?.closed ?? 0} closed</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="grid gap-1 sm:grid-cols-2 pr-2">
                {(resilience?.circuitBreakers ?? []).slice(0, 12).map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-1 px-2 rounded border border-border/30 text-xs">
                    <span className="truncate">{b.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${b.state === 'closed' ? 'border-emerald-500/30 text-emerald-500' : b.state === 'half_open' ? 'border-amber-500/30 text-amber-500' : 'border-rose-500/30 text-rose-500'}`}>
                      {b.state}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Active alerts */}
        <Card className="border-emerald-500/15">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-rose-500" /> Active Alerts</CardTitle>
            <CardDescription className="text-xs">{resilience?.alertCount ?? 0} alert(s) in last 5 min</CardDescription>
          </CardHeader>
          <CardContent>
            {(resilience?.activeAlerts ?? []).length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No active alerts" hint="All systems nominal." />
            ) : (
              <ScrollArea className="h-40">
                <div className="space-y-1 pr-2">
                  {(resilience?.activeAlerts ?? []).map((a: any) => (
                    <div key={a.id} className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">{a.source}</span>
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">{a.severity}</Badge>
                      </div>
                      <p className="text-muted-foreground truncate">{a.message}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" onClick={load} className="border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10">
        <RefreshCw className="h-4 w-4" /> Reload infra
      </Button>
    </div>
  );
}

// ============================================================ loading
function LoadingDashboard() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
