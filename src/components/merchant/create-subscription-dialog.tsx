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
const INTERVALS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
] as const;

export function CreateSubscriptionDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [planName, setPlanName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('GHS');
  const [interval, setInterval] = useState<string>('MONTHLY');
  const [trialDays, setTrialDays] = useState('');

  function reset() {
    setPlanName('');
    setAmount('');
    setCurrency('GHS');
    setInterval('MONTHLY');
    setTrialDays('');
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = planName.trim();
    if (!trimmedName) {
      toast.error('Please provide a plan name');
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const trialDaysNum = Number(trialDays);
    const trialDaysValue =
      Number.isFinite(trialDaysNum) && trialDaysNum > 0
        ? Math.floor(trialDaysNum)
        : 0;

    setSubmitting(true);
    try {
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: trimmedName,
          amount: numericAmount,
          currency,
          interval,
          trialDays: trialDaysValue || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create subscription plan');
      }
      toast.success('Subscription plan created');
      handleOpenChange(false);
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create subscription plan',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> Create plan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create subscription plan</DialogTitle>
            <DialogDescription>
              Define a recurring billing plan your customers can subscribe to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="sub-name">Plan name</Label>
            <Input
              id="sub-name"
              placeholder="e.g. Pro Monthly"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              required
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="sub-amount">Amount</Label>
              <Input
                id="sub-amount"
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
              <Label htmlFor="sub-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="sub-currency" className="w-full">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-interval">Billing interval</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger id="sub-interval" className="w-full">
                  <SelectValue placeholder="Interval" />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-trial">Trial days (optional)</Label>
              <Input
                id="sub-trial"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="0"
                value={trialDays}
                onChange={(e) => setTrialDays(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                'Create plan'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
