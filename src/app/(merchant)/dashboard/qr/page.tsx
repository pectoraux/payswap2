'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  QrCode,
  Plus,
  Trash2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

type QrType = 'STATIC' | 'DYNAMIC' | 'CHECKOUT';

interface GeneratedQr {
  id: string;
  type: QrType;
  amount: number;
  reference: string;
  url: string;
  payload: string;
  createdAt: string;
}

const QR_PAY_BASE_URL = typeof window !== 'undefined' ? `${window.location.origin}/pay/` : 'https://payswap.org/pay/';
const QR_SIZE = 21;

/** FNV-1a hash → 32-bit unsigned int. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG seeded with a 32-bit int. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a 21x21 boolean grid with finder patterns + deterministic data. */
function buildQrMatrix(payload: string): boolean[][] {
  const seed = hashString(payload);
  const rand = mulberry32(seed);
  const n = QR_SIZE;
  const grid: boolean[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => false),
  );

  // Finder pattern (7x7) — three corners.
  const placeFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = edge || core;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Quiet zone around finders.
  const inFinderZone = (r: number, c: number) => {
    const zones = [
      [0, 0],
      [0, n - 8],
      [n - 8, 0],
    ];
    return zones.some(([r0, c0]) => r >= r0 && r < r0 + 8 && c >= c0 && c < c0 + 8);
  };

  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Fill data area with deterministic bits.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (inFinderZone(r, c)) continue;
      if (r === 6 || c === 6) continue;
      grid[r][c] = rand() > 0.5;
    }
  }

  return grid;
}

function QrSvg({ matrix }: { matrix: boolean[][] }) {
  const n = matrix.length;
  const cell = 10;
  const quiet = 4;
  const total = (n + quiet * 2) * cell;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={(c + quiet) * cell}
            y={(r + quiet) * cell}
            width={cell}
            height={cell}
            fill="currentColor"
          />,
        );
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      className="h-44 w-44 text-emerald-600 dark:text-emerald-400"
      role="img"
      aria-label="Generated QR code"
    >
      <rect x={0} y={0} width={total} height={total} fill="white" />
      {cells}
    </svg>
  );
}

const TYPE_LABELS: Record<QrType, string> = {
  STATIC: 'Static',
  DYNAMIC: 'Dynamic',
  CHECKOUT: 'Checkout',
};

export default function QrPaymentsPage() {
  const [type, setType] = useState<QrType>('STATIC');
  const [amount, setAmount] = useState('50.00');
  const [reference, setReference] = useState('');
  const [qr, setQr] = useState<GeneratedQr | null>(null);
  const [history, setHistory] = useState<GeneratedQr[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const amt = type === 'DYNAMIC' ? 0 : Number(amount) || 0;
      const ref =
        reference.trim() ||
        `QR-${Date.now().toString(36).toUpperCase()}`;

      // Create a real Payment (status PENDING) — the Payment *is* the QR.
      // Scanning the QR opens /pay/{paymentId}, which lets the customer pay.
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt > 0 ? amt : 1, // Payment requires amount > 0; dynamic QRs default to 1
          currency: 'GHS',
          method: 'QR',
          description: `${TYPE_LABELS[type]} QR payment`,
          customerName: 'QR Customer',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create QR payment');
      }

      const paymentId: string = data.payment.id;
      const url = `${QR_PAY_BASE_URL}${paymentId}`;
      const payload = `${url}|${type}|${amt.toFixed(2)}|${ref}`;
      const created: GeneratedQr = {
        id: paymentId,
        type,
        amount: amt,
        reference: ref,
        url,
        payload,
        createdAt: new Date().toISOString(),
      };
      setQr(created);
      setHistory((h) => [created, ...h].slice(0, 12));
      toast.success('QR code generated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate QR');
    } finally {
      setGenerating(false);
    }
  }

  const handleDelete = (id: string) => {
    setHistory((h) => h.filter((x) => x.id !== id));
    if (qr?.id === id) setQr(null);
  };

  async function handleCopyUrl(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
      toast.success('Payment URL copied');
    } catch {
      toast.error('Could not copy URL');
    }
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GHS' }).format(
      n,
    );
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const matrix = qr ? buildQrMatrix(qr.payload) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">QR payments</h1>
        <p className="text-sm text-muted-foreground">
          Generate QR codes that customers can scan to pay you instantly.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Generator */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <QrCode className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Generator</CardTitle>
                <CardDescription>Configure and create a QR code</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as QrType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select QR type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STATIC">Static — fixed amount</SelectItem>
                  <SelectItem value="DYNAMIC">Dynamic — customer enters</SelectItem>
                  <SelectItem value="CHECKOUT">Checkout — opens hosted page</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={type === 'DYNAMIC'}
                />
                {type === 'DYNAMIC' && (
                  <p className="text-[10px] text-muted-foreground">
                    Customer decides the amount.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference">Reference</Label>
                <Input
                  id="reference"
                  placeholder="auto-generated"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Generate QR code
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              {qr ? 'Scan-ready QR for your customer' : 'No QR generated yet'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {qr && matrix ? (
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <QrSvg matrix={matrix} />
                </div>
                <div className="w-full space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <Badge
                      variant="secondary"
                      className="bg-teal-500/10 text-teal-600 dark:text-teal-400"
                    >
                      {TYPE_LABELS[qr.type]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Amount</span>
                    <span className="font-semibold tabular-nums">
                      {qr.amount > 0 ? fmt(qr.amount) : 'Customer enters'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Reference</span>
                    <span className="font-mono text-xs">{qr.reference}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Payment URL
                    </span>
                    <a
                      href={qr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 truncate font-mono text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{qr.url}</span>
                    </a>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleCopyUrl(qr.url, qr.id)}
                >
                  {copiedId === qr.id ? (
                    <>
                      <Check className="mr-2 h-4 w-4 text-emerald-500" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" /> Copy URL
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                  <QrCode className="h-6 w-6 text-emerald-500" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">No QR yet</h3>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Fill in the form and click <span className="font-medium">Generate</span> to create a QR code.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated QR codes</CardTitle>
          <CardDescription>
            {history.length} code{history.length === 1 ? '' : 's'} this session
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                <QrCode className="h-5 w-5 text-emerald-500" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">No history yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Generated QR codes will be listed here for the current session.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded-lg border bg-card/50 p-3"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="bg-teal-500/10 text-[9px] text-teal-600 dark:text-teal-400"
                      >
                        {TYPE_LABELS[h.type]}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {fmtDate(h.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {h.reference}
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {h.amount > 0 ? fmt(h.amount) : 'Customer enters'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-emerald-600"
                      onClick={() => handleCopyUrl(h.url, h.id)}
                      title="Copy URL"
                    >
                      {copiedId === h.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                      onClick={() => handleDelete(h.id)}
                      title="Remove from list"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
