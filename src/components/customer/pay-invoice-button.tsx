'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Wallet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface UnpaidInvoiceView {
  id: string;
  number: string;
  total: number;
  currency: string;
}

interface PayInvoiceButtonProps {
  invoice: UnpaidInvoiceView;
}

async function payInvoice(invoiceId: string) {
  const res = await fetch(`/api/customer/invoices/${invoiceId}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, data };
}

export function PayInvoiceButton({ invoice }: PayInvoiceButtonProps) {
  const [loading, setLoading] = React.useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const { ok, data } = await payInvoice(invoice.id);
      if (ok && data?.ok) {
        toast.success('Invoice paid', {
          description: `${invoice.number} — ${data.payment?.amount ?? invoice.total} ${invoice.currency} from your wallet`,
        });
        // Refresh server component data.
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      } else {
        toast.error('Payment failed', {
          description: data?.error ?? 'Unknown error',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      className="gap-1.5"
      disabled={loading}
      onClick={onClick}
      aria-label={`Pay invoice ${invoice.number} with wallet`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Wallet className="h-3.5 w-3.5" />
      )}
      {loading ? 'Paying…' : 'Pay with wallet'}
    </Button>
  );
}
