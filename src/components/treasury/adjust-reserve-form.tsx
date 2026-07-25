'use client';

import { useState } from 'react';
import { Loader2, Plus, Minus, AlertCircle } from 'lucide-react';
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

export interface AdjustReserveFormProps {
  /** Currencies currently present in wallet aggregates (most-traded first). */
  currencies: string[];
  /** Reserve balances by currency (used to gate removals). */
  balancesByCurrency: Record<string, number>;
}

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

const FALLBACK_CURRENCIES = ['USD', 'GHS', 'KES', 'NGN', 'UGX'];

/**
 * Adjust Reserve form — used by treasury operators to credit or debit the
 * system reserve wallet for a single currency.
 *
 * On submit the form POSTs to /api/treasury/reserves/adjust with:
 *   { currency, amount, action: 'add'|'remove', reason }
 *
 * The API is responsible for finding / creating the system reserve wallet
 * (Merchant name='PaySwap Reserve'), recording a WalletTransaction and an
 * AuditLog entry, and returning the new balance. The page reloads on
 * success so the updated balance + history reflect immediately.
 */
export function AdjustReserveForm({
  currencies,
  balancesByCurrency,
}: AdjustReserveFormProps) {
  const currencyOptions = currencies.length > 0 ? currencies : FALLBACK_CURRENCIES;
  const [currency, setCurrency] = useState(currencyOptions[0]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null);

  const effectiveCurrency = currency || currencyOptions[0];
  const currentBalance = balancesByCurrency[effectiveCurrency] ?? 0;
  const parsedAmount = parseFloat(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const removeExceedsBalance = amountValid && parsedAmount > currentBalance;
  const reasonValid = reason.trim().length > 0;
  const canSubmit = amountValid && reasonValid && busy === null;

  async function submit(action: 'add' | 'remove') {
    if (!amountValid) {
      toast.error('Enter a positive amount');
      return;
    }
    if (!reasonValid) {
      toast.error('A reason is required for every reserve adjustment');
      return;
    }
    if (action === 'remove' && removeExceedsBalance) {
      toast.error(
        `Insufficient reserve. Current: ${fmtCurrency(currentBalance, effectiveCurrency)}`,
      );
      return;
    }
    setBusy(action);
    try {
      const res = await fetch('/api/treasury/reserves/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: effectiveCurrency,
          amount: parsedAmount,
          action,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Adjustment failed (${res.status})`);
      }
      const verb = action === 'add' ? 'Added' : 'Removed';
      toast.success(
        `${verb} ${fmtCurrency(parsedAmount, effectiveCurrency)} ${action === 'add' ? 'to' : 'from'} ${effectiveCurrency} reserve`,
      );
      setAmount('');
      setReason('');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4 text-emerald-500" />
          Adjust reserve
        </CardTitle>
        <CardDescription>
          Credit or debit the PaySwap system reserve wallet for a single
          currency. Every adjustment is journaled and audit-logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reserve-currency">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="reserve-currency" className="w-full">
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Current balance:{' '}
              <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtCurrency(currentBalance, effectiveCurrency)}
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reserve-amount">Amount</Label>
            <Input
              id="reserve-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50000"
              className="tabular-nums"
            />
            <p className="text-[11px] text-muted-foreground">
              Amount in {effectiveCurrency}.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reserve-reason">Reason</Label>
          <Textarea
            id="reserve-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this reserve being adjusted? (required, audited)"
            rows={3}
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground">
            Recorded in the AuditLog with your name and timestamp.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={() => submit('add')}
            disabled={!canSubmit}
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {busy === 'add' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" /> Add reserve
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => submit('remove')}
            disabled={!canSubmit || removeExceedsBalance}
            variant="outline"
            className="flex-1 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            {busy === 'remove' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing…
              </>
            ) : (
              <>
                <Minus className="mr-2 h-4 w-4" /> Remove reserve
              </>
            )}
          </Button>
        </div>

        {amountValid && removeExceedsBalance && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Removal exceeds the current {effectiveCurrency} reserve balance.
              Lower the amount or add reserves first.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
