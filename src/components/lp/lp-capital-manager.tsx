'use client';

import { useState } from 'react';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface LpCapitalSnapshot {
  stake: number;
  collateral: number;
  available: number;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

export function LpCapitalManager({ lp }: { lp: LpCapitalSnapshot }) {
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    setSubmittingDeposit(true);
    try {
      const res = await fetch('/api/lp/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deposit', amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to deposit');
      toast.success(`Deposited ${fmtCurrency(amount)} to your stake`);
      setDepositAmount('');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deposit');
    } finally {
      setSubmittingDeposit(false);
    }
  }

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    if (amount > lp.available) {
      toast.error(
        `Insufficient available capital. Available: ${fmtCurrency(lp.available)}`,
      );
      return;
    }
    setSubmittingWithdraw(true);
    try {
      const res = await fetch('/api/lp/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to withdraw');
      toast.success(`Withdrew ${fmtCurrency(amount)} from your stake`);
      setWithdrawAmount('');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to withdraw');
    } finally {
      setSubmittingWithdraw(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Capital management</CardTitle>
        <CardDescription>
          Add or withdraw capital. Deposits increase both your stake and posted
          collateral in equal measure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="deposit">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit" className="gap-1.5">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Add capital
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="gap-1.5">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              Withdraw
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="mt-4">
            <form onSubmit={deposit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="deposit-amount">Amount (USD)</Label>
                <Input
                  id="deposit-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  className="tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  Funds settle into your LP stake and are immediately available
                  as collateral.
                </p>
              </div>
              <Button
                type="submit"
                disabled={submittingDeposit}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {submittingDeposit ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Depositing…
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="mr-2 h-4 w-4" /> Add capital
                  </>
                )}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="withdraw" className="mt-4">
            <form onSubmit={withdraw} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="withdraw-amount">Amount (USD)</Label>
                <Input
                  id="withdraw-amount"
                  type="number"
                  min="0"
                  max={lp.available}
                  step="0.01"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder={`up to ${fmtCurrency(lp.available)}`}
                  className="tabular-nums"
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Available to withdraw</span>
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtCurrency(lp.available)}
                  </span>
                </div>
              </div>

              {lp.available === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    All of your stake is currently committed as collateral against
                    open positions. Settle those positions before withdrawing.
                  </span>
                </div>
              )}

              <Button
                type="submit"
                disabled={submittingWithdraw || lp.available === 0}
                variant="outline"
                className="w-full border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
              >
                {submittingWithdraw ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Withdrawing…
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="mr-2 h-4 w-4" /> Withdraw capital
                  </>
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
