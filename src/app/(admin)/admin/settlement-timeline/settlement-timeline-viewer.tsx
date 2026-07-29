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
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Clock,
  Search,
  ArrowRight,
  Coins,
  TimerReset,
  CheckCircle2,
  Hourglass,
} from 'lucide-react';
import {
  SectionLabel,
  StatTile,
  Timeline,
  type TimelineStage,
  fmtNum,
  fmtUsd,
  fmtDate,
} from '@/components/dashboards/visuals';

export type SettlementContractStatus =
  | 'created'
  | 'funded'
  | 'claimed'
  | 'accepted'
  | 'awaiting_recipient'
  | 'confirmed'
  | 'released'
  | 'closed'
  | 'expired'
  | 'disputed';

export interface SettlementContractDTO {
  id: string;
  status: SettlementContractStatus;
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  escrowAmount: number;
  escrowCurrency: string;
  lpId?: string;
  recipientId?: string;
  createdAt: number;
  fundedAt?: number;
  claimedAt?: number;
  confirmedAt?: number;
  releasedAt?: number;
  closedAt?: number;
  expiresAt: number;
  strategy: string;
}

interface Props {
  initial: SettlementContractDTO[];
}

const STATUS_OPTIONS: { value: 'all' | SettlementContractStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'created', label: 'Created' },
  { value: 'funded', label: 'Funded' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'awaiting_recipient', label: 'Awaiting recipient' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'released', label: 'Released' },
  { value: 'closed', label: 'Closed' },
  { value: 'expired', label: 'Expired' },
  { value: 'disputed', label: 'Disputed' },
];

const STATUS_STYLES: Record<SettlementContractStatus, string> = {
  created: 'bg-muted text-muted-foreground',
  funded: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  claimed: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  accepted: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  awaiting_recipient: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  confirmed: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  released: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  closed: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  expired: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  disputed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

// Order of the canonical lifecycle stages.
const LIFECYCLE: { key: string; label: string; ts: (c: SettlementContractDTO) => number | undefined }[] = [
  { key: 'created', label: 'Created', ts: (c) => c.createdAt },
  { key: 'funded', label: 'Funded', ts: (c) => c.fundedAt },
  { key: 'claimed', label: 'Claimed', ts: (c) => c.claimedAt },
  // 'accepted' has no explicit timestamp on the contract; treat as same as claimed.
  { key: 'accepted', label: 'Accepted', ts: (c) => (c.claimedAt ? c.claimedAt + 1 : undefined) },
  { key: 'awaiting_recipient', label: 'Awaiting', ts: (c) => (c.claimedAt ? c.claimedAt + 2 : undefined) },
  { key: 'confirmed', label: 'Confirmed', ts: (c) => c.confirmedAt },
  { key: 'released', label: 'Released', ts: (c) => c.releasedAt },
  { key: 'closed', label: 'Closed', ts: (c) => c.closedAt },
];

function computeStages(c: SettlementContractDTO): TimelineStage[] {
  // Determine current stage index based on status.
  const statusIdx = LIFECYCLE.findIndex((s) => s.key === c.status);
  const currentIdx =
    c.status === 'expired' || c.status === 'disputed'
      ? -1
      : statusIdx < 0
        ? -1
        : statusIdx;

  return LIFECYCLE.map((s, i) => {
    const ts = s.ts(c);
    const reached = i <= currentIdx;
    return {
      key: s.key,
      label: s.label,
      state: reached ? (i === currentIdx ? 'current' : 'completed') : 'pending',
      timestamp: reached ? ts : undefined,
      detail:
        i === currentIdx && c.status === 'awaiting_recipient'
          ? 'Waiting for recipient confirmation'
          : undefined,
    } satisfies TimelineStage;
  });
}

export function SettlementTimelineViewer({ initial }: Props) {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [selected, setSelected] = React.useState<SettlementContractDTO | null>(null);

  const filtered = React.useMemo(() => {
    return initial.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.id.toLowerCase().includes(q) &&
          !c.fromCountry.toLowerCase().includes(q) &&
          !c.toCountry.toLowerCase().includes(q) &&
          !(c.lpId ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [initial, statusFilter, search]);

  // Aggregate counts per status.
  const counts = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of initial) map[c.status] = (map[c.status] ?? 0) + 1;
    return map;
  }, [initial]);

  const inFlight = (counts['created'] ?? 0) + (counts['funded'] ?? 0) + (counts['claimed'] ?? 0) + (counts['accepted'] ?? 0) + (counts['awaiting_recipient'] ?? 0);
  const closed = counts['closed'] ?? 0;
  const expired = (counts['expired'] ?? 0) + (counts['disputed'] ?? 0);

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total contracts"
          value={initial.length}
          hint="All escrowed settlements"
          tone="emerald"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatTile
          label="In-flight"
          value={inFlight}
          hint="Created → awaiting recipient"
          tone="amber"
          icon={<Hourglass className="h-4 w-4" />}
        />
        <StatTile
          label="Closed"
          value={closed}
          hint="Successfully released & closed"
          tone="teal"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatTile
          label="Expired / disputed"
          value={expired}
          hint="Requires investigation"
          tone={expired > 0 ? 'rose' : 'default'}
          icon={<TimerReset className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-emerald-500" />
                Contract lifecycles
              </CardTitle>
              <CardDescription>
                Each contract&apos;s journey through the 8-stage escrow lifecycle. Click any contract for full detail.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter strip */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contract ID / country / LP…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contract list with timelines */}
          <div className="max-h-[40rem] space-y-3 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No contracts match the current filter.
              </div>
            ) : (
              filtered.map((c) => {
                const stages = computeStages(c);
                const expiresIn = c.expiresAt - Date.now();
                const expired = expiresIn < 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="w-full rounded-lg border bg-card/40 p-3 text-left transition hover:border-emerald-500/40 hover:bg-emerald-500/[0.02]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold">{c.id}</span>
                        <Badge variant="outline" className={`text-[9px] ${STATUS_STYLES[c.status]}`}>
                          {c.status.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {c.strategy}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] tabular-nums">
                        <span className="font-mono text-muted-foreground">
                          {c.fromCountry} <ArrowRight className="inline h-2.5 w-2.5" /> {c.toCountry}
                        </span>
                        <span className="font-semibold">{fmtUsd(c.amount)} {c.toCurrency}</span>
                        <span className="text-muted-foreground">
                          escrow {fmtUsd(c.escrowAmount)} {c.escrowCurrency}
                        </span>
                        <span className={`text-[10px] ${expired ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                          {expired ? 'expired' : `expires in ${Math.round(expiresIn / 3_600_000)}h`}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Timeline stages={stages} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{selected.id}</SheetTitle>
                <SheetDescription>
                  Full lifecycle of this settlement contract.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <DetailTile label="Status" value={selected.status.replace(/_/g, ' ')} tone={STATUS_STYLES[selected.status]} />
                  <DetailTile label="Strategy" value={selected.strategy} />
                  <DetailTile label="From" value={`${selected.fromCountry} · ${selected.fromCurrency}`} />
                  <DetailTile label="To" value={`${selected.toCountry} · ${selected.toCurrency}`} />
                  <DetailTile label="Amount" value={`${fmtNum(selected.amount, 2)} ${selected.toCurrency}`} />
                  <DetailTile label="Escrow" value={`${fmtNum(selected.escrowAmount, 2)} ${selected.escrowCurrency}`} />
                  <DetailTile label="LP" value={selected.lpId ?? '—'} />
                  <DetailTile label="Recipient" value={selected.recipientId ?? '—'} />
                </div>

                <div className="rounded-lg border p-3">
                  <SectionLabel>Lifecycle timeline</SectionLabel>
                  <div className="mt-3">
                    <Timeline stages={computeStages(selected)} />
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <SectionLabel>Stage timestamps</SectionLabel>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <KVRow k="Created" v={fmtDate(selected.createdAt)} />
                    <KVRow k="Funded" v={fmtDate(selected.fundedAt)} />
                    <KVRow k="Claimed" v={fmtDate(selected.claimedAt)} />
                    <KVRow k="Confirmed" v={fmtDate(selected.confirmedAt)} />
                    <KVRow k="Released" v={fmtDate(selected.releasedAt)} />
                    <KVRow k="Closed" v={fmtDate(selected.closedAt)} />
                    <KVRow k="Expires at" v={fmtDate(selected.expiresAt)} />
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-xs font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-xs">{v}</span>
    </div>
  );
}
