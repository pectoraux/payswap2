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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  FileSignature,
  Search,
  ChevronRight,
  Coins,
  Clock,
} from 'lucide-react';

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
  timeoutMs: number;
  strategy: string;
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

function fmtNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n ?? 0);
}

function fmtDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={'text-right ' + (mono ? 'font-mono text-xs' : '')}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/**
 * Admin: Settlement Contracts console.
 *
 * Lists every settlement contract in the runtime with a status filter, plus a
 * detail Sheet showing the full lifecycle (created → funded → claimed →
 * accepted → awaiting recipient → confirmed → released → closed).
 */
export function SettlementContractsViewer({
  initial,
}: {
  initial: SettlementContractDTO[];
}) {
  const [status, setStatus] = React.useState<'all' | SettlementContractStatus>('all');
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<SettlementContractDTO | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return initial.filter((c) => {
      if (status !== 'all' && c.status !== status) return false;
      if (!q) return true;
      return (
        c.id.toLowerCase().includes(q) ||
        c.fromCountry.toLowerCase().includes(q) ||
        c.toCountry.toLowerCase().includes(q) ||
        c.fromCurrency.toLowerCase().includes(q) ||
        c.toCurrency.toLowerCase().includes(q) ||
        c.strategy.toLowerCase().includes(q) ||
        (c.lpId ?? '').toLowerCase().includes(q)
      );
    });
  }, [initial, status, query]);

  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const c of initial) {
      map.set(c.status, (map.get(c.status) ?? 0) + 1);
    }
    return map;
  }, [initial]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Contracts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{initial.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In-flight</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {(counts.get('funded') ?? 0) +
                (counts.get('claimed') ?? 0) +
                (counts.get('accepted') ?? 0) +
                (counts.get('awaiting_recipient') ?? 0) +
                (counts.get('confirmed') ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Released / Closed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {(counts.get('released') ?? 0) + (counts.get('closed') ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expired / Disputed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {(counts.get('expired') ?? 0) + (counts.get('disputed') ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSignature className="h-4 w-4" />
                Settlement Contracts
              </CardTitle>
              <CardDescription>
                Each contract tracks an escrowed cross-border settlement from
                creation to release.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by id, country, currency, LP…"
                  className="h-9 w-full pl-7 sm:w-72"
                />
              </div>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as 'all' | SettlementContractStatus)}
              >
                <SelectTrigger className="h-9 w-44">
                  <SelectValue placeholder="Filter by status" />
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
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No settlement contracts match the current filters.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Contract ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Corridor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Escrow</TableHead>
                    <TableHead>LP</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Claimed</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        {c.id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium capitalize ${
                            STATUS_STYLES[c.status] ?? ''
                          }`}
                        >
                          {c.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-medium">{c.fromCountry}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium">{c.toCountry}</span>
                        <div className="text-[10px] text-muted-foreground">
                          {c.fromCurrency} → {c.toCurrency}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.amount)}{' '}
                        <span className="text-[10px] text-muted-foreground">
                          {c.fromCurrency}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.escrowAmount)}{' '}
                        <span className="text-[10px] text-muted-foreground">
                          {c.escrowCurrency}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.lpId ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(c.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(c.claimedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(c.confirmedAt)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <FileSignature className="h-4 w-4" />
                  Settlement Contract
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {selected.id}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={`text-[10px] font-medium capitalize ${
                      STATUS_STYLES[selected.status] ?? ''
                    }`}
                  >
                    {selected.status.replace(/_/g, ' ')}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {selected.strategy}
                  </Badge>
                </div>

                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Corridor
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {selected.fromCountry} → {selected.toCountry}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selected.fromCurrency} → {selected.toCurrency}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Amount
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-base font-bold tabular-nums">
                    <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    {fmtNumber(selected.amount)} {selected.fromCurrency}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Escrow: {fmtNumber(selected.escrowAmount)}{' '}
                    {selected.escrowCurrency}
                  </div>
                </div>

                <div className="mt-4">
                  <DetailRow label="Contract ID" value={selected.id} mono />
                  <DetailRow
                    label="LP"
                    value={selected.lpId ?? '—'}
                    mono
                  />
                  <DetailRow
                    label="Recipient"
                    value={selected.recipientId ?? '—'}
                    mono
                  />
                  <DetailRow
                    label="Strategy"
                    value={selected.strategy}
                  />
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> Lifecycle
                  </div>
                  <div className="rounded-lg border bg-card/50">
                    <DetailRow label="Created" value={fmtDate(selected.createdAt)} />
                    <DetailRow label="Funded" value={fmtDate(selected.fundedAt)} />
                    <DetailRow label="Claimed" value={fmtDate(selected.claimedAt)} />
                    <DetailRow
                      label="Confirmed"
                      value={fmtDate(selected.confirmedAt)}
                    />
                    <DetailRow label="Released" value={fmtDate(selected.releasedAt)} />
                    <DetailRow label="Closed" value={fmtDate(selected.closedAt)} />
                    <DetailRow
                      label="Expires at"
                      value={fmtDate(selected.expiresAt)}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
