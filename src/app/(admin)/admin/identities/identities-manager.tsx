'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  User, Building2, Briefcase, Landmark, Globe, Wallet, Bot, Cpu,
  ShieldCheck, ShieldAlert, Ban, RotateCcw, KeyRound, BadgeCheck,
  Users2, Lock, Loader2, RefreshCw, ChevronRight, Plus, Trash2,
  ArrowRight, Mail, Phone, Smartphone, HardDrive, UserCheck, Copy,
  CircleDot, Activity, Scale,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/empty-state';
import type {
  IdentityType, IdentityStatus, TrustLevel, Credential, Attestation,
  Delegation, RecoveryMethod, Identity,
} from '@/identity';

// ─── Public summary types (mirror the API responses) ───────────────────────

export interface IdentitySummary {
  id: string;
  type: IdentityType;
  name: string;
  entityId: string;
  entityType: string;
  trustScore: number;
  trustLevel: TrustLevel;
  status: IdentityStatus;
  credentialCount: number;
  attestationCount: number;
  delegationCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface IdentityOverviewSnapshot {
  total: number;
  byType: Record<IdentityType, number>;
  byTrustLevel: Record<TrustLevel, number>;
  byStatus: Record<IdentityStatus, number>;
  credentials: number;
  attestations: number;
  delegations: number;
  recoveryMethods: number;
  proofs: number;
  averageTrustScore: number;
}

interface Props {
  identities: IdentitySummary[];
  overview: IdentityOverviewSnapshot;
}

// ─── Identity-type metadata ─────────────────────────────────────────────────

const TYPE_META: Record<
  IdentityType,
  { label: string; icon: typeof User; tone: string; description: string }
> = {
  person: {
    label: 'Person',
    icon: User,
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    description: 'Individual human',
  },
  merchant: {
    label: 'Merchant',
    icon: Building2,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    description: 'Business that accepts payments',
  },
  lp: {
    label: 'LP',
    icon: Briefcase,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    description: 'Liquidity provider',
  },
  organization: {
    label: 'Organization',
    icon: Users2,
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    description: 'Organization (can own merchants/LPs)',
  },
  government: {
    label: 'Government',
    icon: Landmark,
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    description: 'Government entity (regulator, central bank)',
  },
  wallet: {
    label: 'Wallet',
    icon: Wallet,
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    description: 'Programmatic payment wallet',
  },
  ai_agent: {
    label: 'AI Agent',
    icon: Bot,
    tone: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20',
    description: 'AI agent with delegated authority',
  },
  device: {
    label: 'Device',
    icon: Cpu,
    tone: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    description: 'IoT device (POS, ATM)',
  },
};

const TRUST_META: Record<TrustLevel, { label: string; tone: string }> = {
  unverified: { label: 'Unverified', tone: 'bg-muted text-muted-foreground border-border' },
  verified: { label: 'Verified', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  trusted: { label: 'Trusted', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  privileged: { label: 'Privileged', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
};

const STATUS_META: Record<IdentityStatus, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  suspended: { label: 'Suspended', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  revoked: { label: 'Revoked', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
};

const ALL_TYPES: IdentityType[] = [
  'person', 'merchant', 'lp', 'organization', 'government', 'wallet', 'ai_agent', 'device',
];
const ALL_TRUST: TrustLevel[] = ['unverified', 'verified', 'trusted', 'privileged'];
const ALL_STATUS: IdentityStatus[] = ['active', 'suspended', 'revoked'];

const CREDENTIAL_TYPES = ['password', 'api_key', 'oauth', 'certificate', 'biometric', 'hardware_key'] as const;
const ATTESTATION_TYPES = ['identity', 'address', 'income', 'business', 'sanctions_clear', 'pep_clear', 'credit_score', 'custom'] as const;
const RECOVERY_TYPES = ['email', 'phone', 'backup_codes', 'social', 'hardware_key', 'trusted_contact'] as const;

// ─── Main component ────────────────────────────────────────────────────────

export function IdentitiesManager({ identities: initial, overview }: Props) {
  const [identities, setIdentities] = useState<IdentitySummary[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<IdentityType | 'ALL'>('ALL');
  const [trustFilter, setTrustFilter] = useState<TrustLevel | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<IdentityStatus | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return identities.filter((i) => {
      if (typeFilter !== 'ALL' && i.type !== typeFilter) return false;
      if (trustFilter !== 'ALL' && i.trustLevel !== trustFilter) return false;
      if (statusFilter !== 'ALL' && i.status !== statusFilter) return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [identities, query, typeFilter, trustFilter, statusFilter]);

  const selected = identities.find((i) => i.id === selectedId) ?? filtered[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      if (trustFilter !== 'ALL') params.set('trustLevel', trustFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`/api/identities?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data?.identities) {
        toast.error('Failed to refresh identities');
        return;
      }
      setIdentities(data.identities as IdentitySummary[]);
    } catch {
      toast.error('Failed to refresh identities');
    }
  }, [typeFilter, trustFilter, statusFilter, query]);

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatTile
          label="Total identities"
          value={overview.total}
          icon={<CircleDot className="h-4 w-4" />}
          tone={overview.total > 0 ? 'emerald' : undefined}
        />
        <StatTile
          label="Avg trust score"
          value={overview.averageTrustScore}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone={overview.averageTrustScore >= 70 ? 'emerald' : overview.averageTrustScore < 40 ? 'rose' : undefined}
        />
        <StatTile label="Credentials" value={overview.credentials} icon={<KeyRound className="h-4 w-4" />} />
        <StatTile label="Attestations" value={overview.attestations} icon={<BadgeCheck className="h-4 w-4" />} />
        <StatTile label="Delegations" value={overview.delegations} icon={<Users2 className="h-4 w-4" />} />
        <StatTile label="Recovery methods" value={overview.recoveryMethods} icon={<Lock className="h-4 w-4" />} />
      </div>

      {/* By-type distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Identity distribution by type</CardTitle>
          <CardDescription className="text-xs">
            Each participant in PaySwap is an Identity — from individual humans to AI agents and physical devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {ALL_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const count = overview.byType[t] ?? 0;
              return (
                <div
                  key={t}
                  className="flex flex-col items-center rounded-md border bg-muted/30 px-2 py-3 text-center"
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${meta.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-lg font-bold tabular-nums">{count}</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {meta.label}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main split view */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Sidebar list */}
        <Card className="h-fit">
          <CardHeader className="pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Identities</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                className="h-7 px-2 text-xs"
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Refresh
              </Button>
            </div>
            <Input
              placeholder="Search by name or ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as IdentityType | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {ALL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={trustFilter} onValueChange={(v) => setTrustFilter(v as TrustLevel | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Trust" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All trust</SelectItem>
                  {ALL_TRUST.map((t) => (
                    <SelectItem key={t} value={t}>{TRUST_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IdentityStatus | 'ALL')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All status</SelectItem>
                  {ALL_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh]">
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                  No identities match the current filters.
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((i) => {
                    const meta = TYPE_META[i.type];
                    const Icon = meta.icon;
                    const isSelected = selectedId === i.id;
                    return (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(i.id)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                            isSelected ? 'bg-muted/60' : ''
                          }`}
                        >
                          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{i.name}</span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                {i.trustScore}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${meta.tone}`}>
                                {meta.label}
                              </Badge>
                              <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${TRUST_META[i.trustLevel].tone}`}>
                                {TRUST_META[i.trustLevel].label}
                              </Badge>
                              <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${STATUS_META[i.status].tone}`}>
                                {STATUS_META[i.status].label}
                              </Badge>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="font-mono">{i.entityType}</span>
                              <span>·</span>
                              <span>{i.credentialCount} cred</span>
                              <span>·</span>
                              <span>{i.attestationCount} att</span>
                              <span>·</span>
                              <span>{i.delegationCount} dlg</span>
                            </div>
                          </div>
                          {isSelected ? <ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail panel */}
        <div className="min-w-0">
          {selected ? (
            <IdentityDetail identity={selected} onChanged={refresh} />
          ) : (
            <Card>
              <EmptyState
                icon={<User className="h-5 w-5" />}
                title="No identity selected"
                description="Select an identity from the list to inspect its credentials, attestations, delegations, and recovery methods."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Identity detail ───────────────────────────────────────────────────────

function IdentityDetail({
  identity,
  onChanged,
}: {
  identity: IdentitySummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fullIdentity, setFullIdentity] = useState<Identity | null>(null);
  const meta = TYPE_META[identity.type];
  const Icon = meta.icon;

  // Load the full identity (with credentials, attestations, delegations,
  // recovery methods) from the detail endpoint.
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identity.id)}`);
      const data = await res.json();
      if (!res.ok || !data?.identity) return;
      setFullIdentity(data.identity as Identity);
    } catch {
      // ignore — detail panel just shows the summary
    }
  }, [identity.id]);

  // Load detail on first render and whenever the selected identity changes.
  useMemo(() => {
    setFullIdentity(null);
    loadDetail();
  }, [identity.id, loadDetail]);

  const act = async (action: 'suspend' | 'revoke' | 'reactivate') => {
    setBusy(true);
    try {
      const body = action === 'suspend' || action === 'revoke'
        ? { reason: `${action} by admin` }
        : undefined;
      const res = await fetch(
        `/api/identities/${encodeURIComponent(identity.id)}/${action}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? `Failed to ${action} identity`);
      } else {
        toast.success(`Identity ${action}ed`);
        onChanged();
        loadDetail();
      }
    } catch {
      toast.error(`Failed to ${action} identity`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full ${meta.tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <CardTitle className="text-lg">{identity.name}</CardTitle>
                <Badge variant="outline" className={`h-5 ${meta.tone}`}>
                  {meta.label}
                </Badge>
                <Badge variant="outline" className={`h-5 ${TRUST_META[identity.trustLevel].tone}`}>
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  {TRUST_META[identity.trustLevel].label}
                </Badge>
                <Badge variant="outline" className={`h-5 ${STATUS_META[identity.status].tone}`}>
                  {STATUS_META[identity.status].label}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {meta.description} · <span className="font-mono">{identity.entityType}:{identity.entityId}</span>
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {identity.status === 'active' ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act('suspend')}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-1.5 h-3.5 w-3.5" />}
                    Suspend
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act('revoke')} className="text-rose-600 hover:text-rose-700">
                    <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => act('reactivate')} className="bg-emerald-600 text-white hover:bg-emerald-700">
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  Reactivate
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trust score */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">Trust score</span>
              <span className="font-mono text-sm tabular-nums">{identity.trustScore} / 100</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${
                  identity.trustScore >= 90 ? 'bg-violet-500'
                  : identity.trustScore >= 70 ? 'bg-emerald-500'
                  : identity.trustScore >= 40 ? 'bg-sky-500'
                  : 'bg-rose-500'
                }`}
                style={{ width: `${identity.trustScore}%` }}
              />
            </div>
          </div>

          {/* Sub-sections */}
          <div className="grid gap-4 md:grid-cols-2">
            <CredentialsSection identityId={identity.id} onChanged={loadDetail} />
            <AttestationsSection identityId={identity.id} onChanged={loadDetail} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <DelegationsSection identityId={identity.id} />
            <RecoverySection identityId={identity.id} onChanged={loadDetail} />
          </div>

          {fullIdentity ? (
            <Section icon={<Activity className="h-3.5 w-3.5" />} title="Lifecycle metadata">
              <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-[10px] leading-tight">
                {JSON.stringify(
                  {
                    id: fullIdentity.id,
                    createdAt: new Date(fullIdentity.createdAt).toISOString(),
                    updatedAt: new Date(fullIdentity.updatedAt).toISOString(),
                    suspendedAt: fullIdentity.suspendedAt ? new Date(fullIdentity.suspendedAt).toISOString() : undefined,
                    suspendedReason: fullIdentity.suspendedReason,
                    revokedAt: fullIdentity.revokedAt ? new Date(fullIdentity.revokedAt).toISOString() : undefined,
                    revokedReason: fullIdentity.revokedReason,
                  },
                  null,
                  2,
                )}
              </pre>
            </Section>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Credentials section ───────────────────────────────────────────────────

function CredentialsSection({
  identityId,
  onChanged,
}: {
  identityId: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<(typeof CREDENTIAL_TYPES)[number]>('api_key');
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [verified, setVerified] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/credentials`);
      const data = await res.json();
      if (res.ok && data?.credentials) setItems(data.credentials);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [identityId]);

  useMemo(() => {
    setItems([]);
    load();
  }, [identityId, load]);

  const submit = async () => {
    if (!identifier.trim()) {
      toast.error('Identifier is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, identifier, secret: secret || undefined, verified }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to add credential');
      } else {
        toast.success('Credential added');
        setDialogOpen(false);
        setIdentifier('');
        setSecret('');
        setVerified(false);
        load();
        onChanged();
      }
    } catch {
      toast.error('Failed to add credential');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (credentialId: string) => {
    try {
      const res = await fetch(
        `/api/identities/${encodeURIComponent(identityId)}/credentials/${encodeURIComponent(credentialId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to remove credential');
      } else {
        toast.success('Credential removed');
        load();
        onChanged();
      }
    } catch {
      toast.error('Failed to remove credential');
    }
  };

  return (
    <Section
      icon={<KeyRound className="h-3.5 w-3.5" />}
      title={`Credentials (${items.length})`}
      action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add credential</DialogTitle>
              <DialogDescription>
                Issue a new credential to this identity. The secret (if provided) is hashed before storage.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREDENTIAL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Identifier (email, key fingerprint, …)</Label>
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g., ops@merchant.com"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Secret (plaintext — will be hashed)</Label>
                <Input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="leave blank for OAuth / certificate / biometric"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cred-verified"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="cred-verified" className="text-xs">Mark as verified</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Add credential
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Empty text="No credentials" />
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 rounded-md border bg-muted/20 p-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">{c.type}</Badge>
                  {c.verified ? (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      verified
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      unverified
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px]">{c.identifier}</div>
                {c.expiresAt ? (
                  <div className="text-[10px] text-muted-foreground">
                    expires {new Date(c.expiresAt).toLocaleDateString()}
                  </div>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-rose-600 hover:text-rose-700"
                onClick={() => remove(c.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Attestations section ──────────────────────────────────────────────────

function AttestationsSection({
  identityId,
  onChanged,
}: {
  identityId: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Attestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<(typeof ATTESTATION_TYPES)[number]>('identity');
  const [attesterIdentityId, setAttesterIdentityId] = useState('');
  const [value, setValue] = useState('');
  const [confidence, setConfidence] = useState(80);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/attestations`);
      const data = await res.json();
      if (res.ok && data?.attestations) setItems(data.attestations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [identityId]);

  useMemo(() => {
    setItems([]);
    load();
  }, [identityId, load]);

  const submit = async () => {
    if (!attesterIdentityId.trim() || !value.trim()) {
      toast.error('Attester identity ID and value are required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/attestations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, attesterIdentityId, value, confidence }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to create attestation');
      } else {
        toast.success('Attestation created');
        setDialogOpen(false);
        setAttesterIdentityId('');
        setValue('');
        setConfidence(80);
        load();
        onChanged();
      }
    } catch {
      toast.error('Failed to create attestation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<BadgeCheck className="h-3.5 w-3.5" />}
      title={`Attestations (${items.length})`}
      action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create attestation</DialogTitle>
              <DialogDescription>
                An attester identity vouches for a claim about this identity. The attester must be active and verified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Attestation type</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTESTATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Attester identity ID</Label>
                <Input
                  value={attesterIdentityId}
                  onChange={(e) => setAttesterIdentityId(e.target.value)}
                  placeholder="id_xxxxxxxxxxxxxxxx"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Value (the attested claim)</Label>
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g., Ghana National ID verified"
                  rows={2}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Confidence: {confidence}%</Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Create attestation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Empty text="No attestations" />
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((a) => (
            <li key={a.id} className="rounded-md border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{a.type}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{a.confidence}% conf</span>
              </div>
              <div className="mt-1 text-[11px]">{a.value}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                by {a.attesterName} · {new Date(a.createdAt).toLocaleDateString()}
                {a.revokedAt ? ' · REVOKED' : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Delegations section ───────────────────────────────────────────────────

function DelegationsSection({ identityId }: { identityId: string }) {
  const [fromItems, setFromItems] = useState<Delegation[]>([]);
  const [toItems, setToItems] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toIdentityId, setToIdentityId] = useState('');
  const [scopeText, setScopeText] = useState('payments:read');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/delegations`);
      const data = await res.json();
      if (res.ok && data) {
        setFromItems(data.from ?? []);
        setToItems(data.to ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [identityId]);

  useMemo(() => {
    setFromItems([]);
    setToItems([]);
    load();
  }, [identityId, load]);

  const submit = async () => {
    if (!toIdentityId.trim() || !scopeText.trim()) {
      toast.error('To identity ID and scope are required');
      return;
    }
    const scope = scopeText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (scope.length === 0) {
      toast.error('Scope must be a comma-separated list of permission strings');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/delegations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toIdentityId, scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to create delegation');
      } else {
        toast.success('Delegation created');
        setDialogOpen(false);
        setToIdentityId('');
        setScopeText('payments:read');
        load();
      }
    } catch {
      toast.error('Failed to create delegation');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (delegationId: string) => {
    try {
      const res = await fetch(
        `/api/identities/${encodeURIComponent(identityId)}/delegations/${encodeURIComponent(delegationId)}/revoke`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Revoked by admin' }) },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to revoke delegation');
      } else {
        toast.success('Delegation revoked');
        load();
      }
    } catch {
      toast.error('Failed to revoke delegation');
    }
  };

  return (
    <Section
      icon={<Users2 className="h-3.5 w-3.5" />}
      title={`Delegations (from ${fromItems.length} · to ${toItems.length})`}
      action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Delegate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delegate authority</DialogTitle>
              <DialogDescription>
                Grant another identity the right to act on this identity's behalf, scoped to specific permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">To identity ID</Label>
                <Input
                  value={toIdentityId}
                  onChange={(e) => setToIdentityId(e.target.value)}
                  placeholder="id_xxxxxxxxxxxxxxxx"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Scope (comma-separated)</Label>
                <Input
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  placeholder="payments:read, payments:write"
                  className="h-9 font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Use dotted permission strings (e.g., <code>payments:write</code>, <code>treasury:read</code>).
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Delegate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : fromItems.length === 0 && toItems.length === 0 ? (
        <Empty text="No delegations" />
      ) : (
        <div className="space-y-3">
          {fromItems.length > 0 ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Delegated to others ({fromItems.length})
              </div>
              <ul className="space-y-1.5 text-xs">
                {fromItems.map((d) => (
                  <li key={d.id} className="rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px]">→ {d.toIdentityId.slice(0, 18)}…</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-rose-600 hover:text-rose-700"
                        onClick={() => revoke(d.id)}
                        disabled={!!d.revokedAt}
                      >
                        Revoke
                      </Button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.scope.map((s) => (
                        <Badge key={s} variant="outline" className="h-4 px-1.5 text-[10px] font-mono">
                          {s}
                        </Badge>
                      ))}
                    </div>
                    {d.limits?.maxAmount ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        max {d.limits.maxAmount} {d.limits.currency ?? 'USD'}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {toItems.length > 0 ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Acts on behalf of ({toItems.length})
              </div>
              <ul className="space-y-1.5 text-xs">
                {toItems.map((d) => (
                  <li key={d.id} className="rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono">{d.fromIdentityId.slice(0, 18)}…</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.scope.map((s) => (
                        <Badge key={s} variant="outline" className="h-4 px-1.5 text-[10px] font-mono">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ─── Recovery section ──────────────────────────────────────────────────────

const RECOVERY_META: Record<
  (typeof RECOVERY_TYPES)[number],
  { label: string; icon: typeof Mail }
> = {
  email: { label: 'Email', icon: Mail },
  phone: { label: 'Phone', icon: Phone },
  backup_codes: { label: 'Backup codes', icon: Copy },
  social: { label: 'Social', icon: Globe },
  hardware_key: { label: 'Hardware key', icon: HardDrive },
  trusted_contact: { label: 'Trusted contact', icon: UserCheck },
};

function RecoverySection({
  identityId,
  onChanged,
}: {
  identityId: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<RecoveryMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<(typeof RECOVERY_TYPES)[number]>('email');
  const [identifier, setIdentifier] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/recovery`);
      const data = await res.json();
      if (res.ok && data?.methods) setItems(data.methods);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [identityId]);

  useMemo(() => {
    setItems([]);
    load();
  }, [identityId, load]);

  const submit = async () => {
    if (type !== 'backup_codes' && !identifier.trim()) {
      toast.error('Identifier is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(identityId)}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, identifier: identifier || `${identityId}:backup-codes` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? 'Failed to add recovery method');
      } else {
        toast.success('Recovery method added');
        setDialogOpen(false);
        setIdentifier('');
        load();
        onChanged();
      }
    } catch {
      toast.error('Failed to add recovery method');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Lock className="h-3.5 w-3.5" />}
      title={`Recovery methods (${items.length})`}
      action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add recovery method</DialogTitle>
              <DialogDescription>
                Recovery methods let the underlying entity regain access if their primary credentials are lost.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECOVERY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{RECOVERY_META[t].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {type !== 'backup_codes' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Identifier (email, phone, contact handle, …)</Label>
                  <Input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g., recovery@merchant.com"
                    className="h-9 text-sm"
                  />
                </div>
              ) : (
                <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                  Backup codes will be auto-generated (10 one-time codes).
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Add recovery method
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Empty text="No recovery methods" />
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((m) => {
            const meta = RECOVERY_META[m.type];
            const Icon = meta.icon;
            return (
              <li key={m.id} className="rounded-md border bg-muted/20 p-2">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{meta.label}</Badge>
                  {m.verified ? (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      verified
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      unverified
                    </Badge>
                  )}
                </div>
                <div className="mt-1 truncate font-mono text-[11px]">{m.identifier}</div>
                {m.backupCodes && m.backupCodes.length > 0 ? (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {m.backupCodes.length} codes remaining
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function StatTile({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'emerald' | 'rose';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'rose'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={`mt-2 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({
  icon, title, children, action,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">{text}</div>;
}

// Keep these icons referenced for the distribution panel (avoids unused-import lint).
void Smartphone;
void Scale;
void Separator;
