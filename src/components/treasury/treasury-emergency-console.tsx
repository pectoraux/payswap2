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
import { Badge } from '@/components/ui/badge';
import {
  ShieldAlert,
  Snowflake,
  Unlock,
  Loader2,
  Globe2,
  Route,
  Vault,
  Wallet,
  Clock,
  History,
  AlertCircle,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────

export type EmergencyTarget = 'country' | 'corridor' | 'reserve' | 'wallet';

export interface EmergencyFreezeDTO {
  id: string;
  target: EmergencyTarget;
  targetId: string;
  reason: string;
  frozenAt: string;
  expiresAt?: string | null;
  durationMs?: number | null;
  status: 'active' | 'lifted' | 'expired';
  liftedAt?: string | null;
  liftedBy?: string;
  initiatedByUserId?: string;
  initiatedByEmail?: string;
}

export interface EmergencyStatusData {
  active: EmergencyFreezeDTO[];
  expired: EmergencyFreezeDTO[];
  lifted: EmergencyFreezeDTO[];
  auditTrail: Array<{
    id: string;
    action: string;
    target?: string;
    targetId?: string;
    reason?: string;
    actorEmail?: string;
    createdAt: string;
  }>;
  summary: { active: number; expired: number; lifted: number };
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'EG', name: 'Egypt' },
];

export const CORRIDOR_OPTIONS: string[] = [
  'GHS→KES', 'KES→GHS', 'GHS→NGN', 'NGN→KES', 'KES→UGX',
  'UGX→KES', 'NGN→GHS', 'GHS→USD', 'KES→USD', 'NGN→USD',
];

export const RESERVE_OPTIONS: string[] = [
  'reserve-usd-1', 'reserve-ghs-1', 'reserve-kes-1',
  'reserve-ngn-1', 'reserve-ugx-1',
];

export const WALLET_OPTIONS: string[] = [
  'wallet-treasury-hot-1', 'wallet-treasury-cold-1',
  'wallet-settlement-1', 'wallet-lp-collateral-1', 'wallet-refund-escrow-1',
];

const TARGET_META: Record<
  EmergencyTarget,
  { label: string; icon: typeof Globe2; color: string; hint: string }
> = {
  country: {
    label: 'Country',
    icon: Globe2,
    color: 'text-rose-500',
    hint: 'Halt all settlement activity for a country jurisdiction',
  },
  corridor: {
    label: 'Corridor',
    icon: Route,
    color: 'text-amber-500',
    hint: 'Pause a single currency-pair corridor',
  },
  reserve: {
    label: 'Reserve',
    icon: Vault,
    color: 'text-orange-500',
    hint: 'Freeze a treasury reserve from being drawn down',
  },
  wallet: {
    label: 'Wallet',
    icon: Wallet,
    color: 'text-rose-500',
    hint: 'Freeze a treasury / settlement / escrow wallet',
  },
};

const DURATION_PRESETS: Array<{ label: string; ms: number }> = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Indefinite', ms: 0 },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function fmtDuration(ms?: number | null) {
  if (!ms || ms <= 0) return 'Indefinite';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
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
    active: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-transparent',
    lifted: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent',
    expired: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent',
  }[s.toLowerCase()] ?? 'bg-muted text-muted-foreground border-transparent';
  return (
    <Badge className={`text-[10px] font-medium capitalize ${cls}`}>{s}</Badge>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface TreasuryEmergencyConsoleProps {
  initial: EmergencyStatusData;
  isAdmin: boolean;
}

export function TreasuryEmergencyConsole({
  initial,
  isAdmin,
}: TreasuryEmergencyConsoleProps) {
  const [active, setActive] = useState(initial.active);
  const [lifted, setLifted] = useState(initial.lifted);
  const [auditTrail, setAuditTrail] = useState(initial.auditTrail);

  // Form state
  const [target, setTarget] = useState<EmergencyTarget>('country');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [durationMs, setDurationMs] = useState<number>(60 * 60 * 1000); // 1 hour default
  const [busy, setBusy] = useState(false);
  const [unfreezingId, setUnfreezingId] = useState<string | null>(null);

  function targetIdOptions(t: EmergencyTarget): string[] {
    if (t === 'country') return COUNTRY_OPTIONS.map((c) => c.code);
    if (t === 'corridor') return CORRIDOR_OPTIONS;
    if (t === 'reserve') return RESERVE_OPTIONS;
    return WALLET_OPTIONS;
  }

  function targetIdLabel(t: EmergencyTarget, id: string): string {
    if (t === 'country') {
      const c = COUNTRY_OPTIONS.find((x) => x.code === id);
      return c ? `${c.name} (${c.code})` : id;
    }
    return id;
  }

  async function issueFreeze() {
    if (!isAdmin) {
      toast.error('Only admins can issue emergency freezes');
      return;
    }
    if (!targetId.trim()) {
      toast.error('Target ID is required');
      return;
    }
    if (!reason.trim()) {
      toast.error('A reason is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/treasury/emergency/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          targetId: targetId.trim(),
          reason: reason.trim(),
          duration: durationMs > 0 ? durationMs : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Freeze failed (${res.status})`);
      }
      toast.success(
        `${TARGET_META[target].label} ${targetId.trim()} frozen`,
      );
      setActive((prev) => [data.freeze, ...prev]);
      setAuditTrail((prev) => [
        {
          id: `audit-${Date.now()}`,
          action: `TREASURY.EMERGENCY_FREEZE_${target.toUpperCase()}`,
          target,
          targetId: targetId.trim(),
          reason: reason.trim(),
          actorEmail: data.freeze?.initiatedByEmail,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Freeze failed');
    } finally {
      setBusy(false);
    }
  }

  async function liftFreeze(f: EmergencyFreezeDTO) {
    setUnfreezingId(f.id);
    try {
      const res = await fetch('/api/treasury/emergency/unfreeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: f.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Unfreeze failed (${res.status})`);
      }
      toast.success(`Freeze lifted on ${f.targetId}`);
      const liftedRecord: EmergencyFreezeDTO = {
        ...f,
        status: 'lifted',
        liftedAt: new Date().toISOString(),
        liftedBy: data.freeze?.liftedBy ?? 'you',
      };
      setActive((prev) => prev.filter((x) => x.id !== f.id));
      setLifted((prev) => [liftedRecord, ...prev]);
      setAuditTrail((prev) => [
        {
          id: `audit-${Date.now()}`,
          action: 'TREASURY.EMERGENCY_UNFREEZE',
          target: f.target,
          targetId: f.targetId,
          reason: f.reason,
          actorEmail: data.freeze?.liftedBy,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
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
            an Admin role — the freeze button will be rejected. You can still
            lift (unfreeze) active holds.
          </span>
        </div>
      )}

      {/* KPI summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-rose-500/30 bg-rose-500/[0.03]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active freezes
              </span>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {active.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Currently in effect across all targets
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lifted (history)
              </span>
              <Unlock className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {lifted.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Freezes released after review
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Audit events
              </span>
              <History className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {auditTrail.length}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Freeze / unfreeze events recorded
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Freeze form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Snowflake className="h-4 w-4 text-rose-500" />
            Issue emergency freeze
          </CardTitle>
          <CardDescription>
            Halt a country, corridor, reserve, or wallet. Every freeze is
            fully audited and may be lifted at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Target type */}
            <div className="space-y-2">
              <Label>Target type</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(TARGET_META) as EmergencyTarget[]).map((t) => {
                  const meta = TARGET_META[t];
                  const Icon = meta.icon;
                  const selected = target === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTarget(t);
                        setTargetId('');
                      }}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors ${
                        selected
                          ? 'border-rose-500/40 bg-rose-500/[0.05] text-rose-600 dark:text-rose-400'
                          : 'border-border bg-card hover:bg-muted/40'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${meta.color}`} />
                      <span className="font-medium">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {TARGET_META[target].hint}
              </p>
            </div>

            {/* Target ID */}
            <div className="space-y-2">
              <Label htmlFor="target-id">Target ID</Label>
              {target === 'country' ? (
                <Select
                  value={targetId}
                  onValueChange={setTargetId}
                >
                  <SelectTrigger id="target-id" className="w-full">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={targetId}
                  onValueChange={setTargetId}
                >
                  <SelectTrigger id="target-id" className="w-full">
                    <SelectValue placeholder={`Select ${target}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {targetIdOptions(target).map((id) => (
                      <SelectItem key={id} value={id}>
                        {targetIdLabel(target, id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="…or enter custom target ID"
                className="text-xs"
              />
            </div>

            {/* Reason */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="freeze-reason">
                Reason <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                id="freeze-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this target being frozen? (required, audited)"
                rows={3}
                maxLength={1000}
              />
            </div>

            {/* Duration */}
            <div className="space-y-2 md:col-span-2">
              <Label>Duration</Label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => setDurationMs(d.ms)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      durationMs === d.ms
                        ? 'border-rose-500/40 bg-rose-500/[0.05] text-rose-600 dark:text-rose-400'
                        : 'border-border bg-card hover:bg-muted/40'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              onClick={issueFreeze}
              disabled={
                busy || !isAdmin || !targetId.trim() || !reason.trim()
              }
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Snowflake className="mr-2 h-4 w-4" />
              )}
              Freeze {TARGET_META[target].label.toLowerCase()}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick freeze actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ban className="h-4 w-4 text-amber-500" />
            Quick freeze actions
          </CardTitle>
          <CardDescription>
            One-tap freezes for the most common emergency scenarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(TARGET_META) as EmergencyTarget[]).map((t) => {
              const meta = TARGET_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!isAdmin || busy}
                  onClick={() => {
                    setTarget(t);
                    const opts = targetIdOptions(t);
                    setTargetId(opts[0] ?? '');
                    setReason('');
                    setDurationMs(60 * 60 * 1000);
                    // scroll up to the form
                    if (typeof window !== 'undefined') {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-md bg-rose-500/10 ${meta.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">
                      Freeze {meta.label.toLowerCase()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {meta.hint}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Active freezes */}
      <Card className="border-rose-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-rose-500" />
            Active freezes
          </CardTitle>
          <CardDescription>
            Currently active emergency freezes. Tap Unfreeze to release a hold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Unlock className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-semibold">No active freezes</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                The platform is operating normally — no emergency freezes are
                in effect.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Target</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Frozen at</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((f) => {
                    const meta = TARGET_META[f.target];
                    const Icon = meta.icon;
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                            <span className="text-xs font-medium capitalize">
                              {f.target}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {f.targetId}
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {f.reason}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(f.frozenAt)}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {fmtDuration(f.durationMs)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {f.expiresAt ? (
                            <span className="flex items-center gap-1 tabular-nums">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              {timeUntil(f.expiresAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(f.status)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => liftFreeze(f)}
                            disabled={unfreezingId !== null}
                            className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                          >
                            {unfreezingId === f.id ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Unlock className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Unfreeze
                          </Button>
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

      {/* Lifted history */}
      {lifted.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-emerald-500" />
              Lifted freezes (history)
            </CardTitle>
            <CardDescription>
              Recently released emergency freezes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Target</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Frozen at</TableHead>
                    <TableHead>Lifted at</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lifted.slice(0, 30).map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs capitalize">
                        {f.target}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {f.targetId}
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {f.reason}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(f.frozenAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(f.liftedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {f.liftedBy ?? '—'}
                      </TableCell>
                      <TableCell>{statusBadge(f.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit trail */}
      {auditTrail.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-cyan-500" />
              Audit trail
            </CardTitle>
            <CardDescription>
              Durable freeze / unfreeze events persisted to the AuditLog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Target ID</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditTrail.slice(0, 50).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <span className="font-mono text-[10px]">{l.action}</span>
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {l.target ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.targetId ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {l.reason ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.actorEmail ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(l.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
