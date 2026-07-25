'use client';

import { useState } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
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

interface PaymentOption {
  id: string;
  reference?: string | null;
  amount: number;
  currency: string;
}

interface CreateRefundDialogProps {
  payments?: PaymentOption[];
}

export function CreateRefundDialog({ payments = [] }: CreateRefundDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<string>('FULL');
  const [reason, setReason] = useState('');

  function reset() {
    setPaymentId('');
    setAmount('');
    setType('FULL');
    setReason('');
  }

  // Find the selected payment so we can show / cap the refund amount.
  const selectedPayment = payments.find((p) => p.id === paymentId) || null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentId) {
      toast.error('Please select a payment to refund');
      return;
    }
    if (type === 'PARTIAL') {
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        toast.error('Please enter a valid refund amount');
        return;
      }
      if (selectedPayment && numericAmount > selectedPayment.amount) {
        toast.error(
          `Amount exceeds payment total of ${selectedPayment.amount}`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/refunds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          amount: type === 'PARTIAL' ? Number(amount) : undefined,
          type: type.toLowerCase(),
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create refund');
      }
      toast.success('Refund requested');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create refund');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <RotateCcw className="mr-2 h-4 w-4" /> New Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New refund</DialogTitle>
            <DialogDescription>
              Issue a full or partial refund against an existing payment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="ref-payment">Payment</Label>
            {payments.length > 0 ? (
              <Select value={paymentId} onValueChange={setPaymentId}>
                <SelectTrigger id="ref-payment" className="w-full">
                  <SelectValue placeholder="Select a payment" />
                </SelectTrigger>
                <SelectContent>
                  {payments.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.reference || p.id.slice(0, 12)} — {p.currency}{' '}
                      {p.amount.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="ref-payment"
                placeholder="Paste a payment ID"
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
                required
              />
            )}
            {selectedPayment && (
              <p className="text-xs text-muted-foreground">
                Payment total: {selectedPayment.currency}{' '}
                {selectedPayment.amount.toFixed(2)}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ref-type">Refund type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ref-type" className="w-full">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL">Full</SelectItem>
                <SelectItem value="PARTIAL">Partial</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'PARTIAL' && (
            <div className="space-y-1.5">
              <Label htmlFor="ref-amount">Amount</Label>
              <Input
                id="ref-amount"
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ref-reason">Reason</Label>
            <Textarea
              id="ref-reason"
              placeholder="Why is this refund being issued?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20"
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
                'Request refund'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
