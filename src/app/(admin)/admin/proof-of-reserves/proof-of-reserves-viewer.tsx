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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Hash,
} from 'lucide-react';
import { toast } from 'sonner';

export interface ProofOfReservesDTO {
  proofId: string;
  generatedAt: number;
  blockHeight: number;
  reserves: {
    fiatByCurrency: Record<string, number>;
    stablecoinByCurrency: Record<string, number>;
    totalReserves: number;
  };
  liabilities: {
    twinTokensOutstanding: number;
    walletBalancesByCurrency: Record<string, number>;
    pendingSettlements: number;
    totalLiabilities: number;
  };
  proof: {
    solvencyRatio: number;
    isSolvent: boolean;
    isFullyBacked: boolean;
    reserveRatio: number;
    hash: string;
  };
  verified: boolean;
}

function fmtNumber(n: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(n ?? 0);
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Admin: Proof of Reserves viewer.
 *
 * Initial proof is rendered server-side; the "Generate Proof" button calls
 * the same API and refreshes the view.
 */
export function ProofOfReservesViewer({
  initial,
}: {
  initial: ProofOfReservesDTO | null;
}) {
  const [proof, setProof] = React.useState<ProofOfReservesDTO | null>(initial);
  const [loading, setLoading] = React.useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch('/api/regulatory/proof-of-reserves', {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.proof) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setProof(data.proof as ProofOfReservesDTO);
      toast.success(`Proof generated · ${data.proof.proofId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setLoading(false);
    }
  }

  if (!proof) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            No proof generated yet
          </CardTitle>
          <CardDescription>
            Generate a cryptographic proof that PaySwap is solvent and every
            twin token is fully backed by reserves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Generate Proof
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const fiatEntries = Object.entries(proof.reserves.fiatByCurrency);
  const stablecoinEntries = Object.entries(proof.reserves.stablecoinByCurrency);
  const walletEntries = Object.entries(proof.liabilities.walletBalancesByCurrency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            <Hash className="mr-1 h-3 w-3" />
            {proof.proofId}
          </Badge>
          <span>· block height {proof.blockHeight.toLocaleString()}</span>
          <span>· generated {fmtDate(proof.generatedAt)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Generate Proof
            </>
          )}
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Reserves</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(proof.reserves.totalReserves)}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Fiat + stablecoin reserves
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Liabilities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(proof.liabilities.totalLiabilities)}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Twin tokens + wallets + pending
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Solvency Ratio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(proof.proof.solvencyRatio, 4)}
            </div>
            <p
              className={
                'mt-1 text-[10px] font-medium ' +
                (proof.proof.isSolvent
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400')
              }
            >
              {proof.proof.isSolvent ? 'Solvent' : 'Insolvent'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Reserve Ratio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {fmtNumber(proof.proof.reserveRatio, 4)}
            </div>
            <p
              className={
                'mt-1 text-[10px] font-medium ' +
                (proof.proof.isFullyBacked
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400')
              }
            >
              {proof.proof.isFullyBacked ? 'Fully backed' : 'Under-backed'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Verified banner */}
      <Card
        className={
          proof.verified
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-rose-500/40 bg-rose-500/5'
        }
      >
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          {proof.verified ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {proof.verified ? 'Proof verified' : 'Proof failed verification'}
            </div>
            <div className="text-xs text-muted-foreground">
              {proof.verified
                ? 'Total reserves cover all liabilities and twin tokens outstanding.'
                : 'Reserves do not fully cover liabilities and/or twin tokens outstanding.'}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Proof Hash (SHA-256)
            </div>
            <code className="max-w-[280px] truncate rounded bg-muted px-2 py-1 font-mono text-[10px]">
              {proof.proof.hash}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reserves by Currency</CardTitle>
            <CardDescription>
              Fiat reserves (LP stakes) and stablecoin reserves backing twin
              tokens.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fiatEntries.length === 0 && stablecoinEntries.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center text-xs text-muted-foreground"
                      >
                        No reserve balances recorded.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {fiatEntries.map(([ccy, amount]) => (
                    <TableRow key={`fiat-${ccy}`}>
                      <TableCell>
                        <Badge variant="secondary">fiat</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{ccy}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {stablecoinEntries.map(([ccy, amount]) => (
                    <TableRow key={`sc-${ccy}`}>
                      <TableCell>
                        <Badge variant="outline">stablecoin</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{ccy}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Liabilities by Currency</CardTitle>
            <CardDescription>
              Wallet balances owed to customers. Twin tokens outstanding and
              pending settlements are aggregated above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <Badge variant="secondary">twin tokens</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">all</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumber(proof.liabilities.twinTokensOutstanding)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Badge variant="outline">pending settlements</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">all</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumber(proof.liabilities.pendingSettlements)}
                    </TableCell>
                  </TableRow>
                  {walletEntries.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center text-xs text-muted-foreground"
                      >
                        No wallet balances recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    walletEntries.map(([ccy, amount]) => (
                      <TableRow key={`w-${ccy}`}>
                        <TableCell>
                          <Badge variant="outline">wallet</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{ccy}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
