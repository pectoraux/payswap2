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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPES = [
  { value: 'reserve_adjustment', label: 'Reserve adjustment' },
  { value: 'rebalance', label: 'Rebalance' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'fx_hedge', label: 'FX hedge' },
] as const;

const COUNTRIES = [
  { value: 'NG', label: 'Nigeria (NGN)' },
  { value: 'KE', label: 'Kenya (KES)' },
  { value: 'GH', label: 'Ghana (GHS)' },
  { value: 'UG', label: 'Uganda (UGX)' },
  { value: 'TZ', label: 'Tanzania (TZS)' },
  { value: 'ZA', label: 'South Africa (ZAR)' },
] as const;

/**
 * Dialog that requests a new treasury operation. Submits to POST
 * /api/ops/treasury-ops. On success: toast + reload.
 */
export function RequestTreasuryOpDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<string>('reserve_adjustment');
  const [country, setCountry] = useState<string>('NG');
  const [amount, setAmount] = useState('');
  const [rationale, setRationale] = useState('');

  const currency = COUNTRIES.find((c) => c.value === country)?.label
    .match(/\(([^)]+)\)/)?.[1] ?? 'NGN';

  function reset() {
    setType('reserve_adjustment');
    setCountry('NG');
    setAmount('');
    setRationale('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Please provide a positive amount');
      return;
    }
    if (!rationale.trim()) {
      toast.error('Please provide a rationale');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/treasury-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          country,
          currency,
          amount: amt,
          rationale: rationale.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to request operation');
      }
      toast.success('Treasury operation requested');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to request operation',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          Request operation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Request treasury operation</DialogTitle>
            <DialogDescription>
              Open a new treasury operation. Another operator must approve
              before execution (4-eyes principle).
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trop-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="trop-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trop-country">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="trop-country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trop-amount">Amount ({currency})</Label>
            <Input
              id="trop-amount"
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 500000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trop-rationale">Rationale</Label>
            <Textarea
              id="trop-rationale"
              placeholder="Why is this operation needed?"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              className="min-h-20"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
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
                'Request'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
