'use client';

import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeftRight,
  Unlock,
  Coins,
  Clock,
  CheckCircle2,
  HandCoins,
  Loader2,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SettlementOrderDTO {
  id: string;
  corridor: string;
  sourceCurrency: string;
  destinationCurrency: string;
  amount: number;
  feeBps: number;
  status: 'pending' | 'matched' | 'settled' | 'expired' | 'cancelled';
  reason: string;
  paymentReference?: string;
  createdAt: string;
  deadlineAt: string;
  claimedByLpId?: string;
  claimedAt?: string | null;
  settledAt?: string | null;
}

export interface LockedStablecoinDTO {
  id: string;
  lpId: string;
  amount: number;
  currency: string;
  reason: string;
  transferReference?: string;
  status: 'locked' | 'unlocked' | 'released';
  lockedAt: string;
  unlockedAt?: string | null;
  unlockedBy?: string;
}

export interface LpSettlementsData {
  pendingOrders: SettlementOrderDTO[];
  matchedOrders: SettlementOrderDTO[];
  settledOrders: SettlementOrderDTO[];
  lockedStablecoins: LockedStablecoinDTO[];
  unlockHistory: LockedStablecoinDTO[];
  overview: {
    pendingOrders: number;
    pendingVolume: number;
    matchedByLp: number;
    settledByLp: number;
    lockedStablecoins: number;
    lockedAmountByCurrency: Record<string, number>;
  } | null;
  lpId: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtCurrency(n: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(s);
  }
}

function timeUntil(s: string | null | undefined): string {
  if (!s) return '—';
  const ms = new Date(s).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function statusBadge(s: string) {
  const cls = {
    pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent',
    matched: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-transparent',
    settled: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent',
    expired: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent',
    cancelled: 'bg-muted text-muted-foreground border-transparent',
    locked: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent',
    unlocked: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent',
    released: 'bg-muted text-muted-foreground border-transparent',
  }[s.toLowerCase()] ?? 'bg-muted text-muted-foreground border-transparent';
  return (
    <Badge className={`text-[10px] font-medium capitalize ${cls}`}>{s}</Badge>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LpSettlementsConsole({ initial }: { initial: LpSettlementsData }) {
  const [pending, setPending] = useState(initial.pendingOrders);
  const [matched, setMatched] = useState(initial.matchedOrders);
  const [settled, setSettled] = useState(initial.settledOrders);
  const [locked, setLocked] = useState(initial.lockedStablecoins);
  const [unlockHistory, setUnlockHistory] = useState(initial.unlockHistory);
  const [overview, setOverview] = useState(initial.overview);

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [unlockDialog, setUnlockDialog] = useState<LockedStablecoinDTO | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  async function claimOrder(o: SettlementOrderDTO) {
    setClaimingId(o.id);
    try {
      const res = await fetch(
        `/api/lp/settlement-orders/${encodeURIComponent(o.id)}/claim`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Claim failed (${res.status})`);
      }
      toast.success(`Claimed ${fmtCurrency(o.amount, o.sourceCurrency)} on ${o.corridor}`);
      // Move the order from pending → matched
      setPending((prev) => prev.filter((p) => p.id !== o.id));
      setMatched((prev) => [
        { ...o, status: 'matched', claimedAt: new Date().toISOString() },
        ...prev,
      ]);
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              pendingOrders: Math.max(0, prev.pendingOrders - 1),
              pendingVolume: Math.max(0, prev.pendingVolume - o.amount),
              matchedByLp: prev.matchedByLp + 1,
            }
          : prev,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaimingId(null);
    }
  }

  async function confirmUnlock() {
    if (!unlockDialog) return;
    setUnlockingId(unlockDialog.id);
    try {
      const res = await fetch('/api/lp/stablecoins/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lockId: unlockDialog.id,
          reason: unlockReason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Unlock failed (${res.status})`);
      }
      toast.success(
        `Unlocked ${fmtCurrency(unlockDialog.amount, unlockDialog.currency)}`,
      );
      const updated: LockedStablecoinDTO = {
        ...unlockDialog,
        status: 'unlocked',
        unlockedAt: new Date().toISOString(),
        unlockedBy: 'you',
      };
      setLocked((prev) => prev.filter((l) => l.id !== unlockDialog.id));
      setUnlockHistory((prev) => [updated, ...prev]);
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              lockedStablecoins: Math.max(0, prev.lockedStablecoins - 1),
              lockedAmountByCurrency: Object.fromEntries(
                Object.entries(prev.lockedAmountByCurrency).map(([c, v]) => [
                  c,
                  c === unlockDialog.currency ? Math.max(0, v - unlockDialog.amount) : v,
                ]),
              ),
            }
          : prev,
      );
      setUnlockDialog(null);
      setUnlockReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setUnlockingId(null);
    }
  }

  // ─── KPI cards ─────────────────────────────────────────────────────────
  const ov = overview;
  const totalLocked =
    ov && ov.lockedAmountByCurrency
      ? Object.entries(ov.lockedAmountByCurrency)
          .map(([c, v]) => fmtCurrency(v, c))
          .join(' · ')
      : null;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending orders
              </span>
              <ArrowLeftRight className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {ov?.pendingOrders ?? 0}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {ov ? fmtCurrency(ov.pendingVolume, 'USD') : '—'} awaiting claim
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                In-flight (matched)
              </span>
              <HandCoins className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {ov?.matchedByLp ?? 0}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Your claimed orders settling
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settled
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {ov?.settledByLp ?? 0}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Completed by your liquidity
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Locked stablecoins
              </span>
              <Coins className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {ov?.lockedStablecoins ?? 0}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {totalLocked || 'No locks'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending settlement orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HandCoins className="h-4 w-4 text-amber-500" />
            Pending settlement orders
          </CardTitle>
          <CardDescription>
            Settlement orders that couldn&apos;t be auto-absorbed by existing
            bandwidth. Claim one to commit your liquidity to settling it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Inbox className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-medium">No pending orders</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Every pending settlement order is currently absorbed by LP
                bandwidth. New claims will appear here.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="font-mono text-xs">
                          {o.id.slice(0, 12)}
                        </div>
                        {o.paymentReference && (
                          <div className="text-[10px] text-muted-foreground">
                            pay {o.paymentReference}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {o.corridor}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {fmtCurrency(o.amount, o.sourceCurrency)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        {o.feeBps} bps
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="tabular-nums">
                            {timeUntil(o.deadlineAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => claimOrder(o)}
                          disabled={claimingId !== null}
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          {claimingId === o.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <HandCoins className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Claim
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Locked stablecoins */}
      <Card className="border-rose-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-rose-500" />
            Locked stablecoins
          </CardTitle>
          <CardDescription>
            Stablecoins locked during transfers that didn&apos;t complete.
            Unlock them to release the funds back to your available balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {locked.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Unlock className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-medium">No active locks</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Any stablecoins you have locked up in incomplete transfers will
                appear here for unlock.
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Locked at</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locked.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-semibold tabular-nums">
                        {fmtCurrency(l.amount, l.currency)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {l.currency}
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {l.reason}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(l.lockedAt)}
                      </TableCell>
                      <TableCell>{statusBadge(l.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUnlockDialog(l);
                            setUnlockReason('');
                          }}
                          disabled={unlockingId !== null}
                          className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                        >
                          <Unlock className="mr-1.5 h-3.5 w-3.5" />
                          Unlock
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {unlockHistory.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Unlock history
              </div>
              <div className="max-h-48 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Amount</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Locked at</TableHead>
                      <TableHead>Unlocked at</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unlockHistory.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-semibold tabular-nums">
                          {fmtCurrency(l.amount, l.currency)}
                        </TableCell>
                        <TableCell className="text-xs">{l.currency}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(l.lockedAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(l.unlockedAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {l.unlockedBy ?? '—'}
                        </TableCell>
                        <TableCell>{statusBadge(l.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Matched / in-flight */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-cyan-500" />
            In-flight (your claimed orders)
          </CardTitle>
          <CardDescription>
            Orders you have claimed — settlement is now in flight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {matched.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10">
                <Clock className="h-5 w-5 text-cyan-500" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                You have not claimed any settlement orders yet.
              </p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Claimed at</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matched.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">
                        {o.id.slice(0, 12)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {o.corridor}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {fmtCurrency(o.amount, o.sourceCurrency)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        {o.feeBps} bps
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(o.claimedAt)}
                      </TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settlement history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Settlement history
          </CardTitle>
          <CardDescription>
            Orders you have settled through your liquidity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settled.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                No settled orders yet.
              </p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Settled at</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settled.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">
                        {o.id.slice(0, 12)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {o.corridor}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {fmtCurrency(o.amount, o.sourceCurrency)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        {o.feeBps} bps
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(o.settledAt)}
                      </TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unlock dialog */}
      <Dialog
        open={unlockDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUnlockDialog(null);
            setUnlockReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="h-4 w-4 text-emerald-500" />
              Unlock locked stablecoins
            </DialogTitle>
            <DialogDescription>
              {unlockDialog && (
                <>
                  You are about to unlock{' '}
                  <span className="font-semibold text-foreground">
                    {fmtCurrency(unlockDialog.amount, unlockDialog.currency)}
                  </span>{' '}
                  ({unlockDialog.currency}) locked on{' '}
                  {fmtDate(unlockDialog.lockedAt)}.
                </>
              )}{' '}
              The funds will be released back to your available balance.
            </DialogDescription>
          </DialogHeader>

          {unlockDialog && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <div>
                    <div className="font-medium text-foreground">
                      Original lock reason
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {unlockDialog.reason}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="unlock-reason">
                  Unlock reason{' '}
                  <span className="text-muted-foreground">(optional, audited)</span>
                </Label>
                <Textarea
                  id="unlock-reason"
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="e.g. Manual release after retry succeeded"
                  rows={3}
                  maxLength={500}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUnlockDialog(null);
                setUnlockReason('');
              }}
              disabled={unlockingId !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmUnlock}
              disabled={unlockingId !== null}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {unlockingId !== null ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unlock className="mr-2 h-4 w-4" />
              )}
              Confirm unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
