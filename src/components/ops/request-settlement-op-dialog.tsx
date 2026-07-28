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
  { value: 'manual_settlement', label: 'Manual settlement' },
  { value: 'retry_failed', label: 'Retry failed' },
  { value: 'force_complete', label: 'Force complete' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'reconcile', label: 'Reconcile' },
] as const;

/**
 * Dialog that requests a new settlement operation. Submits to POST
 * /api/ops/settlement-ops. On success: toast + reload.
 */
export function RequestSettlementOpDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<string>('manual_settlement');
  const [transactionId, setTransactionId] = useState('');
  const [rationale, setRationale] = useState('');

  function reset() {
    setType('manual_settlement');
    setTransactionId('');
    setRationale('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transactionId.trim()) {
      toast.error('Please provide a transaction id');
      return;
    }
    if (!rationale.trim()) {
      toast.error('Please provide a rationale');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/settlement-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          transactionId: transactionId.trim(),
          rationale: rationale.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to request operation');
      }
      toast.success('Settlement operation requested');
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
            <DialogTitle>Request settlement operation</DialogTitle>
            <DialogDescription>
              Open a new settlement operation. Another operator must approve
              before execution (4-eyes principle).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="sop-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="sop-type" className="w-full">
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
            <Label htmlFor="sop-tx">Transaction id</Label>
            <Input
              id="sop-tx"
              placeholder="e.g. tx-9f3a1c"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sop-rationale">Rationale</Label>
            <Textarea
              id="sop-rationale"
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
