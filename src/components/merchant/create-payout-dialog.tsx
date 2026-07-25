'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CURRENCIES = ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] as const;
const METHODS = [
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'onchain', label: 'On-chain (Stellar)' },
] as const;

export function CreatePayoutDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<string>('bank');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('GHS');
  const [destinationCurrency, setDestinationCurrency] = useState<string>('GHS');
  const [destination, setDestination] = useState('');

  function reset() {
    setMethod('bank');
    setAmount('');
    setCurrency('GHS');
    setDestinationCurrency('GHS');
    setDestination('');
  }

  const destinationPlaceholder =
    method === 'bank'
      ? 'Bank account number (e.g. 0123456789)'
      : method === 'mobile_money'
        ? 'Mobile money phone (e.g. +233…)'
        : 'Stellar wallet address (e.g. G…)';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (!destination.trim()) {
      toast.error('Destination is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/payouts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          sourceAmount: numericAmount,
          sourceCurrency: currency,
          destinationCurrency,
          destination: destination.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create payout');
      }
      toast.success('Payout requested');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create payout');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> New Payout
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New payout</DialogTitle>
            <DialogDescription>
              Withdraw funds from your merchant balance to a bank, mobile money,
              or on-chain destination.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="po-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="po-method" className="w-full">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="po-amount">Amount</Label>
              <Input
                id="po-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-currency">From</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="po-currency" className="w-full">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="po-dcurrency">Destination currency</Label>
            <Select value={destinationCurrency} onValueChange={setDestinationCurrency}>
              <SelectTrigger id="po-dcurrency" className="w-full">
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="po-dest">Destination</Label>
            <Input
              id="po-dest"
              placeholder={destinationPlaceholder}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); reset(); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Requesting…
                </>
              ) : (
                'Request payout'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
