'use client';

import { useState } from 'react';
import {
  Loader2,
  Snowflake,
  ShieldAlert,
  Route,
  User,
  Coins,
  Unlock,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';

export interface ActiveFreeze {
  id: string;
  scope: string;
  target: string;
  reason: string;
  initiatedBy: string;
  initiatedAt: number;
  expiresAt?: number;
  source: 'memory' | 'audit';
  actorEmail?: string;
  createdAt?: string;
}

export interface EmergencyFreezeConsoleProps {
  /** Active freezes (initial state — fetched server-side from AuditLog). */
  activeFreezes: ActiveFreeze[];
  /** All corridor keys observed on payments (for the freeze-corridor select). */
  corridors: string[];
  /** True if the acting user is an admin (ADMIN / SUPER_ADMIN). */
  isAdmin: boolean;
}

const ASSET_OPTIONS = ['TWINGHS', 'TWINKES', 'TWINNGN', 'TWINUGX', 'TWINUSD'];

function fmtDate(ts: number | string | undefined) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SCOPE_LABEL: Record<string, string> = {
  account: 'Account',
  asset: 'Asset',
  corridor: 'Corridor',
};

const SCOPE_ICON: Record<string, typeof User> = {
  account: User,
  asset: Coins,
  corridor: Route,
};

/**
 * Emergency Freeze Console.
 *
 * Three freeze forms (asset / account / corridor) plus a list of currently
 * active freezes with one-tap Unfreeze. The freeze actions POST to
 * /api/treasury/freeze (admin-only); the unfreeze action DELETEs to the same
 * route (treasury or admin).
 *
 * The component reloads the page on every successful action so the
 * AuditLog-driven active-freeze list reflects the new state immediately.
 */
export function EmergencyFreezeConsole({
  activeFreezes,
  corridors,
  isAdmin,
}: EmergencyFreezeConsoleProps) {
  // --- Asset freeze form state ------------------------------------------
  const [asset, setAsset] = useState(ASSET_OPTIONS[0]);
  const [assetReason, setAssetReason] = useState('');
  const [busyAsset, setBusyAsset] = useState(false);

  // --- Account freeze form state ----------------------------------------
  const [accountId, setAccountId] = useState('');
  const [accountReason, setAccountReason] = useState('');
  const [busyAccount, setBusyAccount] = useState(false);

  // --- Corridor freeze form state ---------------------------------------
  const [corridor, setCorridor] = useState(corridors[0] ?? '');
  const [corridorReason, setCorridorReason] = useState('');
  const [busyCorridor, setBusyCorridor] = useState(false);

  // --- Unfreeze state ----------------------------------------------------
  const [unfreezingId, setUnfreezingId] = useState<string | null>(null);

  async function freezeAsset() {
    if (!assetReason.trim()) {
      toast.error('A reason is required');
      return;
    }
    if (!isAdmin) {
      toast.error('Only admins can issue emergency freezes');
      return;
    }
    setBusyAsset(true);
    try {
      const res = await fetch('/api/treasury/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'asset',
          target: asset,
          reason: assetReason.trim(),
          initiatedBy: 'treasury-console',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Freeze failed (${res.status})`);
      }
      toast.success(`Asset ${asset} frozen`);
      setAssetReason('');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Freeze failed');
    } finally {
      setBusyAsset(false);
    }
  }

  async function freezeAccount() {
    if (!accountId.trim()) {
      toast.error('Account ID is required');
      return;
    }
    if (!accountReason.trim()) {
      toast.error('A reason is required');
      return;
    }
    if (!isAdmin) {
      toast.error('Only admins can issue emergency freezes');
      return;
    }
    setBusyAccount(true);
    try {
      const res = await fetch('/api/treasury/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'account',
          target: accountId.trim(),
          reason: accountReason.trim(),
          initiatedBy: 'treasury-console',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Freeze failed (${res.status})`);
      }
      toast.success('Account frozen');
      setAccountId('');
      setAccountReason('');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Freeze failed');
    } finally {
      setBusyAccount(false);
    }
  }

  async function freezeCorridor() {
    if (!corridor) {
      toast.error('Select a corridor to freeze');
      return;
    }
    if (!corridorReason.trim()) {
      toast.error('A reason is required');
      return;
    }
    if (!isAdmin) {
      toast.error('Only admins can issue emergency freezes');
      return;
    }
    // corridor is in the form "FROM→TO".
    const [from, to] = corridor.split('→');
    if (!from || !to) {
      toast.error('Invalid corridor key');
      return;
    }
    setBusyCorridor(true);
    try {
      const res = await fetch('/api/treasury/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'corridor',
          target: { from, to },
          reason: corridorReason.trim(),
          initiatedBy: 'treasury-console',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Freeze failed (${res.status})`);
      }
      toast.success(`Corridor ${corridor} frozen`);
      setCorridorReason('');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Freeze failed');
    } finally {
      setBusyCorridor(false);
    }
  }

  async function unfreeze(freezeId: string) {
    setUnfreezingId(freezeId);
    try {
      const res = await fetch('/api/treasury/freeze', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freezeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Unfreeze failed (${res.status})`);
      }
      toast.success('Freeze lifted');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unfreeze failed');
    } finally {
      setUnfreezingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-[12px] text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You are signed in as a Treasury operator. Emergency freezes require
            an Admin role — the freeze buttons below will be rejected until an
            admin issues them. You can still lift (unfreeze) active holds.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Freeze Asset */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4 text-amber-500" />
              Freeze asset
            </CardTitle>
            <CardDescription>
              Halt all mint / burn / transfer for a Twin Token asset.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="freeze-asset">Asset</Label>
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger id="freeze-asset" className="w-full">
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
              <SelectContent>
                {ASSET_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freeze-asset-reason">Reason</Label>
            <Textarea
              id="freeze-asset-reason"
              value={assetReason}
              onChange={(e) => setAssetReason(e.target.value)}
              placeholder="Why is this asset being frozen? (required, audited)"
              rows={3}
              maxLength={500}
            />
          </div>
          <Button
            type="button"
            onClick={freezeAsset}
            disabled={busyAsset || !isAdmin || !assetReason.trim()}
            className="w-full bg-rose-600 text-white hover:bg-rose-700"
          >
            {busyAsset ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Freezing…
              </>
            ) : (
              <>
                <Snowflake className="mr-2 h-4 w-4" /> Freeze asset
              </>
            )}
          </Button>
          </CardContent>
        </Card>

        {/* Freeze Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-amber-500" />
              Freeze account
            </CardTitle>
            <CardDescription>
              Block a single Twin Token holder from transferring, minting or
              burning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="freeze-account">Account ID</Label>
            <Input
              id="freeze-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g. cu_abc123…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freeze-account-reason">Reason</Label>
            <Textarea
              id="freeze-account-reason"
              value={accountReason}
              onChange={(e) => setAccountReason(e.target.value)}
              placeholder="Why is this account being frozen? (required, audited)"
              rows={3}
              maxLength={500}
            />
          </div>
          <Button
            type="button"
            onClick={freezeAccount}
            disabled={
              busyAccount ||
              !isAdmin ||
              !accountId.trim() ||
              !accountReason.trim()
            }
            className="w-full bg-rose-600 text-white hover:bg-rose-700"
          >
            {busyAccount ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Freezing…
              </>
            ) : (
              <>
                <Snowflake className="mr-2 h-4 w-4" /> Freeze account
              </>
            )}
          </Button>
          </CardContent>
        </Card>

        {/* Freeze Corridor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-amber-500" />
              Freeze corridor
            </CardTitle>
            <CardDescription>
              Halt routing through a settlement corridor (currency pair).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="freeze-corridor">Corridor</Label>
            <Select value={corridor} onValueChange={setCorridor}>
              <SelectTrigger id="freeze-corridor" className="w-full">
                <SelectValue placeholder="Select corridor" />
              </SelectTrigger>
              <SelectContent>
                {corridors.length === 0 ? (
                  <>
                    <SelectItem value="GHS→KES">GHS→KES</SelectItem>
                    <SelectItem value="KES→GHS">KES→GHS</SelectItem>
                    <SelectItem value="GHS→NGN">GHS→NGN</SelectItem>
                    <SelectItem value="NGN→KES">NGN→KES</SelectItem>
                    <SelectItem value="KES→UGX">KES→UGX</SelectItem>
                  </>
                ) : (
                  corridors.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freeze-corridor-reason">Reason</Label>
            <Textarea
              id="freeze-corridor-reason"
              value={corridorReason}
              onChange={(e) => setCorridorReason(e.target.value)}
              placeholder="Why is this corridor being frozen? (required, audited)"
              rows={3}
              maxLength={500}
            />
          </div>
          <Button
            type="button"
            onClick={freezeCorridor}
            disabled={
              busyCorridor ||
              !isAdmin ||
              !corridor ||
              !corridorReason.trim()
            }
            className="w-full bg-rose-600 text-white hover:bg-rose-700"
          >
            {busyCorridor ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Freezing…
              </>
            ) : (
              <>
                <Snowflake className="mr-2 h-4 w-4" /> Freeze corridor
              </>
            )}
          </Button>
          </CardContent>
        </Card>
      </div>

      {/* Active freezes */}
      <Card className="border-rose-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-rose-500" />
            Active freezes
          </CardTitle>
          <CardDescription>
            Currently active emergency freezes derived from the AuditLog.
            Tap Unfreeze to lift a hold (audited).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeFreezes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Unlock className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No active freezes</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                The platform is operating normally — no emergency freezes are
                in effect.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeFreezes.map((f) => {
                const Icon = SCOPE_ICON[f.scope] ?? ShieldAlert;
                return (
                  <div
                    key={f.id}
                    className="flex flex-col gap-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {f.target || '—'}
                          </span>
                          <StatusBadge status="FROZEN" />
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {SCOPE_LABEL[f.scope] ?? f.scope}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{f.id.slice(0, 12)}</span>
                          {' · '}
                          {fmtDate(f.createdAt ?? f.initiatedAt)}
                          {' · '}
                          by {f.actorEmail ?? f.initiatedBy ?? 'system'}
                        </div>
                        {f.reason && (
                          <div className="mt-1 max-w-md truncate text-xs text-foreground/80">
                            “{f.reason}”
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => unfreeze(f.id)}
                      disabled={unfreezingId !== null}
                      className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      {unfreezingId === f.id ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unlock className="mr-2 h-3.5 w-3.5" />
                      )}
                      Unfreeze
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
