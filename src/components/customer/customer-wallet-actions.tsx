'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';

// Fix: QRCodeCanvas uses the canvas API which isn't available during SSR.
// Load it dynamically with ssr: false to prevent hydration errors.
const QRCodeCanvas = dynamic(
  () => import('qrcode.react').then((mod) => mod.QRCodeCanvas),
  { ssr: false, loading: () => <div className="h-[200px] w-[200px] animate-pulse rounded bg-muted" /> },
);
import {
  ArrowDownLeft,
  ArrowUpRight,
  QrCode,
  Send,
  Wallet as WalletIcon,
  Download,
  Copy,
  CheckCircle2,
  Search,
  User,
  Store,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { fmtCurrency, fmtDate } from '@/components/role-ui';

export interface WalletView {
  id: string;
  name: string;
  currency: string;
  balance: number;
  pendingBalance: number;
  lockedBalance: number;
  isDefault: boolean;
}

export interface WalletTransactionView {
  id: string;
  type: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  createdAt: string; // ISO string
}

interface CustomerWalletActionsProps {
  customerId: string;
  wallets: WalletView[];
  transactions: WalletTransactionView[];
}

const CURRENCIES = ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] as const;

// ─── helpers ────────────────────────────────────────────────────────────────
async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, data };
}

// ─── Deposit Dialog ────────────────────────────────────────────────────────
function DepositDialog({ wallets, onDone }: { wallets: WalletView[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState(wallets[0]?.currency ?? 'GHS');
  const [source, setSource] = React.useState('BANK_CARD');
  const [reference, setReference] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await postJSON('/api/customer/wallet/deposit', {
        amount: amt, currency, source, reference: reference.trim() || undefined,
      });
      if (ok && data?.ok) {
        toast.success('Deposit successful', {
          description: `${fmtCurrency(amt, currency)} added via ${source.replace('_', ' ').toLowerCase()}`,
        });
        setOpen(false);
        setAmount(''); setReference('');
        onDone();
      } else {
        toast.error('Deposit failed', { description: data?.error ?? 'Unknown error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <ArrowDownLeft className="h-4 w-4" /> Deposit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit funds</DialogTitle>
          <DialogDescription>
            Top up your wallet. Mock sources for the demo — no real money moves.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dep-amount">Amount</Label>
              <Input
                id="dep-amount" type="number" min="0.01" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK_CARD">Bank card</SelectItem>
                <SelectItem value="MOBILE_MONEY">Mobile money</SelectItem>
                <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-ref">Reference (optional)</Label>
            <Input id="dep-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Memo for this deposit" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Processing…' : 'Confirm deposit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Withdraw Dialog ───────────────────────────────────────────────────────
function WithdrawDialog({ wallets, onDone }: { wallets: WalletView[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState(wallets[0]?.currency ?? 'GHS');
  const [destination, setDestination] = React.useState('BANK_ACCOUNT');
  const [destinationLabel, setDestinationLabel] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const wallet = wallets.find((w) => w.currency === currency);
  const balance = wallet?.balance ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    if (amt > balance) {
      toast.error('Insufficient funds', { description: `Available: ${fmtCurrency(balance, currency)}` });
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await postJSON('/api/customer/wallet/withdraw', {
        amount: amt, currency, destination,
        destinationLabel: destinationLabel.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      if (ok && data?.ok) {
        toast.success('Withdrawal initiated', {
          description: `${fmtCurrency(amt, currency)} → ${destination.replace('_', ' ').toLowerCase()}`,
        });
        setOpen(false);
        setAmount(''); setReference(''); setDestinationLabel('');
        onDone();
      } else {
        toast.error('Withdrawal failed', { description: data?.error ?? 'Unknown error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ArrowUpRight className="h-4 w-4" /> Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw funds</DialogTitle>
          <DialogDescription>
            Cash out from your wallet. Mock destination for the demo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            Available balance: <span className="font-semibold tabular-nums">{fmtCurrency(balance, currency)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wd-amount">Amount</Label>
              <Input
                id="wd-amount" type="number" min="0.01" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Destination</Label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK_ACCOUNT">Bank account</SelectItem>
                <SelectItem value="MOBILE_MONEY">Mobile money</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-label">Destination label (optional)</Label>
            <Input
              id="wd-label" value={destinationLabel}
              onChange={(e) => setDestinationLabel(e.target.value)}
              placeholder="e.g. GCB ••••1234 / MTN +233…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-ref">Reference (optional)</Label>
            <Input id="wd-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Memo for this withdrawal" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Processing…' : 'Confirm withdrawal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recipient picker (autocomplete) ───────────────────────────────────────
interface Recipient {
  type: 'CUSTOMER' | 'MERCHANT';
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
}

function RecipientPicker({
  value, onChange,
}: {
  value: Recipient | null;
  onChange: (r: Recipient | null) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Recipient[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `/api/customer/wallet/recipients?q=${encodeURIComponent(query.trim())}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.ok) {
          setResults(data.recipients ?? []);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value ? `${value.name} (${value.email})` : query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(null);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search by name, email or phone…"
          className="pl-9"
          required={!value}
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(null); setQuery(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {open && (loading || results.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
          {loading && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(r);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
            >
              <span className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full',
                r.type === 'MERCHANT' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-teal-500/15 text-teal-600',
              )}>
                {r.type === 'MERCHANT' ? <Store className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {r.type === 'MERCHANT' ? 'Merchant' : 'Customer'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Transfer Dialog ───────────────────────────────────────────────────────
function TransferDialog({ wallets, onDone }: { wallets: WalletView[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState(wallets[0]?.currency ?? 'GHS');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const wallet = wallets.find((w) => w.currency === currency);
  const balance = wallet?.balance ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient) { toast.error('Choose a recipient'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a positive amount'); return; }
    setSubmitting(true);
    try {
      const { ok, data } = await postJSON('/api/customer/wallet/transfer', {
        recipientType: recipient.type,
        recipientId: recipient.id,
        amount: amt,
        currency,
        note: note.trim() || undefined,
      });
      if (ok && data?.ok) {
        toast.success('Transfer sent', {
          description: `${fmtCurrency(amt, currency)} → ${recipient.name}`,
        });
        setOpen(false);
        setRecipient(null); setAmount(''); setNote('');
        onDone();
      } else {
        toast.error('Transfer failed', { description: data?.error ?? 'Unknown error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Send className="h-4 w-4" /> Send money
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send money</DialogTitle>
          <DialogDescription>
            Transfer from your wallet to another PaySwap customer or merchant.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Recipient</Label>
            <RecipientPicker value={recipient} onChange={setRecipient} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="xf-amount">Amount</Label>
              <Input
                id="xf-amount" type="number" min="0.01" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            Available: <span className="font-semibold tabular-nums">{fmtCurrency(balance, currency)}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xf-note">Note (optional)</Label>
            <Textarea
              id="xf-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's this for?"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !recipient}>
              {submitting ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Scan QR Dialog ────────────────────────────────────────────────────────
interface ParsedQR {
  recipientType: 'CUSTOMER' | 'MERCHANT';
  recipientId: string;
  amount?: number;
  currency?: string;
  note?: string;
}

function parseQRPayload(raw: string): ParsedQR | null {
  const s = raw.trim();
  if (!s.startsWith('pay:')) return null;
  const parts = s.slice(4).split(':');
  // Accept: pay:customer:<id>  or pay:merchant:<id>
  // Also:  pay:merchant:<id>:amount:<n>:currency:<CUR>
  // Also:  pay:customer:<id>:amount:<n>:currency:<CUR>:note:<text>
  if (parts.length < 2) return null;
  const type = parts[0].toUpperCase();
  if (type !== 'CUSTOMER' && type !== 'MERCHANT') return null;
  const recipientId = parts[1];
  if (!recipientId) return null;
  const result: ParsedQR = {
    recipientType: type as 'CUSTOMER' | 'MERCHANT',
    recipientId,
  };
  // walk remaining key:value pairs
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const k = parts[i].toLowerCase();
    const v = parts[i + 1];
    if (k === 'amount') {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) result.amount = n;
    } else if (k === 'currency') {
      if ((CURRENCIES as readonly string[]).includes(v)) result.currency = v;
    } else if (k === 'note') {
      try { result.note = decodeURIComponent(v); } catch { result.note = v; }
    }
  }
  return result;
}

function ScanQrDialog({ wallets, onDone }: { wallets: WalletView[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'scan' | 'manual'>('scan');
  const [payload, setPayload] = React.useState('');
  const [recipientType, setRecipientType] = React.useState<'CUSTOMER' | 'MERCHANT'>('MERCHANT');
  const [recipientId, setRecipientId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState(wallets[0]?.currency ?? 'GHS');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const parsed = React.useMemo(() => (payload ? parseQRPayload(payload) : null), [payload]);

  async function submit() {
    let rType: 'CUSTOMER' | 'MERCHANT';
    let rId: string;
    let amt: number;
    let cur = currency;
    let nt = note;

    if (mode === 'scan') {
      if (!parsed) { toast.error('Invalid QR payload', { description: 'Expected: pay:customer:<id> or pay:merchant:<id>' }); return; }
      rType = parsed.recipientType;
      rId = parsed.recipientId;
      amt = parsed.amount ?? Number(amount);
      if (parsed.currency) cur = parsed.currency;
      if (parsed.note && !nt) nt = parsed.note;
    } else {
      rType = recipientType;
      rId = recipientId.trim();
      amt = Number(amount);
    }

    if (!rId) { toast.error('Recipient id is required'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a positive amount'); return; }

    setSubmitting(true);
    try {
      const { ok, data } = await postJSON('/api/customer/wallet/transfer', {
        recipientType: rType,
        recipientId: rId,
        amount: amt,
        currency: cur,
        note: nt.trim() || undefined,
      });
      if (ok && data?.ok) {
        toast.success('Payment sent', {
          description: `${fmtCurrency(amt, cur)} → ${rType.toLowerCase()} ${rId.slice(0, 8)}…`,
        });
        setOpen(false);
        setPayload(''); setRecipientId(''); setAmount(''); setNote('');
        onDone();
      } else {
        toast.error('Payment failed', { description: data?.error ?? 'Unknown error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <QrCode className="h-4 w-4" /> Scan QR
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan to pay</DialogTitle>
          <DialogDescription>
            Scan a merchant or customer QR code to start a payment.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'scan' | 'manual')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scan">Scan / paste</TabsTrigger>
            <TabsTrigger value="manual">Manual entry</TabsTrigger>
          </TabsList>
          <TabsContent value="scan" className="space-y-3 pt-2">
            <div className="rounded-md border-2 border-dashed bg-muted/30 p-6 text-center">
              <QrCode className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                Camera capture not available in this demo. Paste a QR payload below.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-payload">QR payload</Label>
              <Input
                id="qr-payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="pay:merchant:abc123:amount:50:currency:GHS"
              />
              <p className="text-[11px] text-muted-foreground">
                Format: <code className="rounded bg-muted px-1">pay:merchant:&lt;id&gt;:amount:&lt;n&gt;:currency:&lt;CUR&gt;</code>
              </p>
            </div>
            {parsed && (
              <div className="rounded-md border bg-emerald-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> QR decoded
                </div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  <div>Type: <span className="font-medium text-foreground">{parsed.recipientType.toLowerCase()}</span></div>
                  <div>ID: <span className="font-mono text-foreground">{parsed.recipientId.slice(0, 16)}…</span></div>
                  {parsed.amount != null && <div>Amount: <span className="font-medium text-foreground">{parsed.amount} {parsed.currency ?? ''}</span></div>}
                  {parsed.note && <div>Note: <span className="text-foreground">{parsed.note}</span></div>}
                </div>
              </div>
            )}
            {parsed && parsed.amount == null && (
              <div className="space-y-1.5">
                <Label htmlFor="scan-amount">Amount (not in QR)</Label>
                <Input id="scan-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" required />
              </div>
            )}
            {parsed && parsed.currency && (
              <div className="text-xs text-muted-foreground">
                Currency from QR: <span className="font-medium">{parsed.currency}</span>
              </div>
            )}
          </TabsContent>
          <TabsContent value="manual" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>Recipient type</Label>
              <Select value={recipientType} onValueChange={(v) => setRecipientType(v as 'CUSTOMER' | 'MERCHANT')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MERCHANT">Merchant</SelectItem>
                  <SelectItem value="CUSTOMER">Customer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="man-id">Recipient ID</Label>
              <Input id="man-id" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} placeholder="cuid…" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="man-amount">Amount</Label>
                <Input id="man-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" required />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="man-note">Note (optional)</Label>
              <Textarea id="man-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Memo" />
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button type="button" disabled={submitting || (mode === 'scan' && !parsed)} onClick={submit}>
            {submitting ? 'Processing…' : 'Pay'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Receive Dialog ────────────────────────────────────────────────────────
function ReceiveDialog({ customerId }: { customerId: string }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const payload = `pay:customer:${customerId}`;
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/?pay=${encodeURIComponent(payload)}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed — long-press to copy manually');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive funds</DialogTitle>
          <DialogDescription>
            Show this QR code to a merchant or another customer to receive a payment.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeCanvas value={payload} size={200} includeMargin={false} level="M" />
          </div>
          <div className="w-full space-y-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-center font-mono text-xs break-all">
              {payload}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copy(payload)}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copy payload
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copy(link)}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </Button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Your customer ID: <span className="font-mono">{customerId.slice(0, 16)}…</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Transaction history ───────────────────────────────────────────────────
function TransactionHistory({ transactions }: { transactions: WalletTransactionView[] }) {
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <ArrowUpRight className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-sm font-semibold">No transactions yet</h3>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Deposits, withdrawals, transfers and invoice payments will appear here.
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-96 overflow-y-auto pr-1">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Counterparty</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((t) => {
            const incoming = t.amount >= 0;
            const typeLabel =
              t.type === 'CREDIT' ? 'Credit' :
              t.type === 'DEBIT' ? 'Debit' :
              t.type === 'LOCK' ? 'Lock' :
              t.type === 'UNLOCK' ? 'Unlock' : t.type;
            return (
              <TableRow key={t.id}>
                <TableCell>
                  <StatusBadge status={typeLabel} />
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                  {t.counterparty || '—'}
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                  {t.reference || '—'}
                </TableCell>
                <TableCell className={cn(
                  'text-right font-semibold tabular-nums',
                  incoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}>
                  {incoming ? '+' : '-'}{fmtCurrency(Math.abs(t.amount), t.currency)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {fmtDate(new Date(t.createdAt))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export function CustomerWalletActions({
  customerId, wallets, transactions,
}: CustomerWalletActionsProps) {
  const refresh = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      // Soft refresh so server components re-render with new balances.
      window.location.reload();
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DepositDialog wallets={wallets} onDone={refresh} />
        <WithdrawDialog wallets={wallets} onDone={refresh} />
        <TransferDialog wallets={wallets} onDone={refresh} />
        <ScanQrDialog wallets={wallets} onDone={refresh} />
        <ReceiveDialog customerId={customerId} />
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <WalletIcon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Transaction history</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
          </span>
        </div>
        <TransactionHistory transactions={transactions} />
      </div>
    </div>
  );
}
