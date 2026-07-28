'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Gauge,
  Plus,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Banknote,
  Coins,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

export type BandwidthAssetType = 'fiat' | 'stablecoin' | 'twin_token';

export interface DebitAuthorizationDTO {
  connector: 'stripe' | 'ach' | 'bank' | 'mobile_money';
  authorized: boolean;
  accountId?: string;
}

export interface BandwidthPositionDTO {
  lpId: string;
  country: string;
  assetType: BandwidthAssetType;
  currency: string;
  capacity: number;
  reserved: number;
  used: number;
  available: number;
  escrow: number;
  bond: number;
  status: 'active' | 'suspended' | 'slashed';
  participationMode: 'automatic' | 'manual';
  debitAuthorization?: DebitAuthorizationDTO;
}

const ASSET_TYPE_ICON: Record<BandwidthAssetType, React.ElementType> = {
  fiat: Banknote,
  stablecoin: Coins,
  twin_token: Layers,
};

const ASSET_TYPE_LABEL: Record<BandwidthAssetType, string> = {
  fiat: 'Fiat',
  stablecoin: 'Stablecoin',
  twin_token: 'Twin Token',
};

const STATUS_STYLES: Record<BandwidthPositionDTO['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  suspended: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  slashed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

function fmtNumber(n: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(n ?? 0);
}

const COUNTRY_OPTIONS = [
  { code: 'GH', name: 'Ghana' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SN', name: 'Senegal' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'EU', name: 'Eurozone' },
];

const CURRENCY_OPTIONS = [
  'GHS', 'NGN', 'KES', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF',
  'ZAR', 'EGP', 'USD', 'EUR', 'GBP', 'USDC', 'USDT',
];

/**
 * LP: Bandwidth Management console.
 *
 * Renders the LP's bandwidth positions (capacity / reserved / used /
 * available / escrow / bond / status) and provides a "Register Bandwidth"
 * dialog that POSTs to /api/runtime/bandwidth.
 *
 * For fiat positions, the debit authorization status is rendered inline so
 * the LP can tell at a glance which positions are authorized to be debited
 * for settlement.
 */
export function BandwidthManagementViewer({
  initial,
  lpId,
}: {
  initial: BandwidthPositionDTO[];
  lpId: string;
}) {
  const [positions, setPositions] = React.useState<BandwidthPositionDTO[]>(initial);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // Dialog form state
  const [country, setCountry] = React.useState<string>('GH');
  const [assetType, setAssetType] = React.useState<BandwidthAssetType>('fiat');
  const [currency, setCurrency] = React.useState<string>('GHS');
  const [capacity, setCapacity] = React.useState<string>('');
  const [bond, setBond] = React.useState<string>('');
  const [participationMode, setParticipationMode] =
    React.useState<'automatic' | 'manual'>('automatic');
  const [debitConnector, setDebitConnector] = React.useState<string>('bank');
  const [debitAccountId, setDebitAccountId] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/runtime/bandwidth', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setPositions((data.positions ?? []) as BandwidthPositionDTO[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cap = Number(capacity);
    const b = Number(bond || 0);
    if (!country) {
      toast.error('Pick a country');
      return;
    }
    if (!currency) {
      toast.error('Pick a currency');
      return;
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      toast.error('Capacity must be a positive number');
      return;
    }
    if (!Number.isFinite(b) || b < 0) {
      toast.error('Bond must be a non-negative number');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        lpId,
        country,
        assetType,
        currency,
        capacity: cap,
        bond: b,
        participationMode,
      };
      if (assetType === 'fiat' && debitAccountId.trim()) {
        payload.debitAuthorization = {
          connector: debitConnector,
          accountId: debitAccountId.trim(),
        };
      }
      const res = await fetch('/api/runtime/bandwidth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.position) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      toast.success('Bandwidth position registered');
      setOpen(false);
      setCapacity('');
      setBond('');
      setDebitAccountId('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Register failed');
    } finally {
      setSubmitting(false);
    }
  }

  const totalCapacity = positions.reduce((s, p) => s + p.capacity, 0);
  const totalReserved = positions.reduce((s, p) => s + p.reserved, 0);
  const totalUsed = positions.reduce((s, p) => s + p.used, 0);
  const totalAvailable = positions.reduce((s, p) => s + p.available, 0);
  const totalEscrow = positions.reduce((s, p) => s + p.escrow, 0);
  const totalBond = positions.reduce((s, p) => s + p.bond, 0);
  const activeCount = positions.filter((p) => p.status === 'active').length;
  const authorizedCount = positions.filter(
    (p) => p.assetType === 'fiat' && p.debitAuthorization?.authorized,
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Capacity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(totalCapacity)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtNumber(totalAvailable)}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              reserved {fmtNumber(totalReserved)} · used {fmtNumber(totalUsed)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Escrow + Bond</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(totalEscrow + totalBond)}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              escrow {fmtNumber(totalEscrow)} · bond {fmtNumber(totalBond)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Debit-Authorized</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {authorizedCount} / {activeCount}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              fiat positions authorized for debit
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4" />
                Bandwidth Positions
              </CardTitle>
              <CardDescription>
                Bandwidth is capacity, not balance. The runtime reserves,
                consumes, and slashes it as settlements flow through the
                network.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Register Bandwidth
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Register bandwidth position</DialogTitle>
                    <DialogDescription>
                      Add a new bandwidth position to the network. The runtime
                      will allocate settlements against it automatically.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submit} className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-country">Country</Label>
                        <Select value={country} onValueChange={setCountry}>
                          <SelectTrigger id="bw-country">
                            <SelectValue placeholder="Country" />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRY_OPTIONS.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-asset-type">Asset type</Label>
                        <Select
                          value={assetType}
                          onValueChange={(v) => setAssetType(v as BandwidthAssetType)}
                        >
                          <SelectTrigger id="bw-asset-type">
                            <SelectValue placeholder="Asset type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fiat">Fiat</SelectItem>
                            <SelectItem value="stablecoin">Stablecoin</SelectItem>
                            <SelectItem value="twin_token">Twin Token</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-currency">Currency</Label>
                        <Select value={currency} onValueChange={setCurrency}>
                          <SelectTrigger id="bw-currency">
                            <SelectValue placeholder="Currency" />
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCY_OPTIONS.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-participation">Participation mode</Label>
                        <Select
                          value={participationMode}
                          onValueChange={(v) =>
                            setParticipationMode(v as 'automatic' | 'manual')
                          }
                        >
                          <SelectTrigger id="bw-participation">
                            <SelectValue placeholder="Mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="automatic">Automatic</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-capacity">Capacity</Label>
                        <Input
                          id="bw-capacity"
                          inputMode="decimal"
                          value={capacity}
                          onChange={(e) => setCapacity(e.target.value)}
                          placeholder="e.g. 10000"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bw-bond">Bond (optional)</Label>
                        <Input
                          id="bw-bond"
                          inputMode="decimal"
                          value={bond}
                          onChange={(e) => setBond(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                    </div>

                    {assetType === 'fiat' && (
                      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          <Lock className="h-3 w-3" />
                          Debit authorization (optional)
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="bw-connector">Connector</Label>
                            <Select
                              value={debitConnector}
                              onValueChange={setDebitConnector}
                            >
                              <SelectTrigger id="bw-connector">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="bank">Bank</SelectItem>
                                <SelectItem value="ach">ACH</SelectItem>
                                <SelectItem value="stripe">Stripe</SelectItem>
                                <SelectItem value="mobile_money">
                                  Mobile Money
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="bw-account">Account ID</Label>
                            <Input
                              id="bw-account"
                              value={debitAccountId}
                              onChange={(e) => setDebitAccountId(e.target.value)}
                              placeholder="account / reference"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOpen(false)}
                        disabled={submitting}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={submitting}>
                        {submitting ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            Registering…
                          </>
                        ) : (
                          <>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Register
                          </>
                        )}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Gauge className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No bandwidth registered</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Register a bandwidth position to start receiving settlement
                allocations from the runtime.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">LP</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Escrow</TableHead>
                    <TableHead className="text-right">Bond</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Debit Auth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p, i) => {
                    const AssetIcon = ASSET_TYPE_ICON[p.assetType];
                    return (
                      <TableRow key={`${p.lpId}-${p.country}-${p.assetType}-${p.currency}-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {p.lpId}
                        </TableCell>
                        <TableCell className="font-medium">{p.country}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <AssetIcon className="h-3 w-3" />
                            {ASSET_TYPE_LABEL[p.assetType]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.currency}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(p.capacity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {fmtNumber(p.reserved)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtNumber(p.used)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                          {fmtNumber(p.available)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(p.escrow)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(p.bond)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] font-medium capitalize ${STATUS_STYLES[p.status] ?? ''}`}
                          >
                            {p.status}
                          </Badge>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {p.participationMode}
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.assetType === 'fiat' ? (
                            p.debitAuthorization?.authorized ? (
                              <Badge
                                variant="secondary"
                                className="gap-1 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400"
                              >
                                <ShieldCheck className="h-3 w-3" />
                                {p.debitAuthorization.connector}
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="gap-1 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400"
                              >
                                <ShieldAlert className="h-3 w-3" />
                                none
                              </Badge>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              n/a
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
