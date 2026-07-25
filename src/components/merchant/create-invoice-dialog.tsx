'use client';

import { useState } from 'react';
import { Plus, Loader2, Trash2 } from 'lucide-react';
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

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyItem(): LineItem {
  return { description: '', quantity: '1', unitPrice: '' };
}

export function CreateInvoiceDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [tax, setTax] = useState('');
  const [currency, setCurrency] = useState<string>('GHS');
  const [dueDate, setDueDate] = useState('');

  function reset() {
    setCustomerEmail('');
    setItems([emptyItem()]);
    setTax('');
    setCurrency('GHS');
    setDueDate('');
  }

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Live subtotal preview.
  const subtotal = items.reduce((sum, it) => {
    const q = Number(it.quantity);
    const p = Number(it.unitPrice);
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);
  const taxPercent = Number(tax) || 0;
  const total = subtotal + (subtotal * taxPercent) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validItems = items
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      }))
      .filter(
        (it) =>
          it.description &&
          Number.isFinite(it.quantity) &&
          it.quantity > 0 &&
          Number.isFinite(it.unitPrice) &&
          it.unitPrice >= 0,
      );

    if (validItems.length === 0) {
      toast.error('Add at least one valid line item');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: customerEmail.trim() || undefined,
          items: validItems,
          tax: taxPercent || undefined,
          currency,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create invoice');
      }
      toast.success('Invoice created successfully');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> New Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>
              Bill a customer for goods or services. Add line items and the
              totals are computed for you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Customer email</Label>
            <Input
              id="inv-email"
              type="email"
              placeholder="customer@example.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addItem}
                className="h-7 px-2 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" /> Add row
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_4rem_5rem_2rem] items-center gap-2"
                >
                  <Input
                    placeholder="Description"
                    value={it.description}
                    onChange={(e) =>
                      updateItem(i, { description: e.target.value })
                    }
                    required={i === 0}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    placeholder="Qty"
                    value={it.quantity}
                    onChange={(e) =>
                      updateItem(i, { quantity: e.target.value })
                    }
                    required={i === 0}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Price"
                    value={it.unitPrice}
                    onChange={(e) =>
                      updateItem(i, { unitPrice: e.target.value })
                    }
                    required={i === 0}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeItem(i)}
                    disabled={items.length === 1}
                    aria-label="Remove row"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-tax">Tax %</Label>
              <Input
                id="inv-tax"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="inv-currency" className="w-full">
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
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border bg-card/40 p-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {currency} {subtotal.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                {currency} {total.toFixed(2)}
              </span>
            </div>
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                'Create invoice'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
