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

interface CreateSarDialogProps {
  alertOptions: Array<{ id: string; label: string }>;
}

export function CreateSarDialog({ alertOptions }: CreateSarDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [subject, setSubject] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);

  function reset() {
    setNarrative('');
    setSubject('');
    setAmount('');
    setCurrency('USD');
    setSelectedAlerts([]);
  }

  function toggleAlert(id: string) {
    setSelectedAlerts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!narrative.trim()) {
      toast.error('Please provide a narrative');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/trust/sars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertIds: selectedAlerts,
          narrative: narrative.trim(),
          subject: subject.trim() || undefined,
          amount: amount ? parseFloat(amount) : undefined,
          currency: currency || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create SAR');
      }
      toast.success('SAR draft created');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create SAR');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" />
          Create SAR
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create SAR draft</DialogTitle>
            <DialogDescription>
              Draft a Suspicious Activity Report. You can attach one or more
              AML alerts as evidence. The draft can be filed with the FIU once
              finalized.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="sar-subject">Subject</Label>
            <Input
              id="sar-subject"
              placeholder="e.g. Ama Serwaa — multi-day structuring"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="sar-amount">Amount (optional)</Label>
              <Input
                id="sar-amount"
                type="number"
                step="0.01"
                placeholder="28500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sar-currency">Currency</Label>
              <Input
                id="sar-currency"
                placeholder="USD"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sar-narrative">Narrative</Label>
            <Textarea
              id="sar-narrative"
              placeholder="Describe the suspicious activity, the entities involved and the pattern observed."
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              className="min-h-28"
              required
            />
          </div>

          {alertOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Attach alerts ({selectedAlerts.length} selected)</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {alertOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-emerald-500/5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAlerts.includes(opt.id)}
                      onChange={() => toggleAlert(opt.id)}
                      className="h-3.5 w-3.5 accent-emerald-600"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              disabled={submitting || !narrative.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                'Create draft'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
