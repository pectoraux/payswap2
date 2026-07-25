'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

export interface CheckoutPayment {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  method: string | null;
  status: string;
  createdAt: string;
  settledAt?: string | null;
}

export interface CheckoutMerchant {
  id: string;
  name: string;
  email: string | null;
  logoUrl: string | null;
  country: string;
}

interface CheckoutFormProps {
  payment: CheckoutPayment;
  merchant: CheckoutMerchant;
}

type Phase = 'idle' | 'paying' | 'success' | 'error';

export function CheckoutForm({ payment, merchant }: CheckoutFormProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [receipt, setReceipt] = useState<CheckoutPayment | null>(null);

  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c,
    }).format(n);

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  async function handlePay() {
    setPhase('paying');
    try {
      const res = await fetch(`/api/payments/${payment.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Payment failed');
      }
      setReceipt(data.payment as CheckoutPayment);
      setPhase('success');
      toast.success('Payment successful');
    } catch (err) {
      setPhase('error');
      toast.error(err instanceof Error ? err.message : 'Payment failed');
    }
  }

  // ─── Success / receipt screen ──────────────────────────────────────────
  if (phase === 'success' && receipt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4 dark:from-background dark:to-background">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <Card className="overflow-hidden shadow-xl">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-center text-white">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring' }}
                className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur"
              >
                <CheckCircle2 className="h-8 w-8" />
              </motion.div>
              <h2 className="text-xl font-bold">Payment Complete</h2>
              <p className="mt-1 text-xs opacity-90">
                {merchant.name} received your payment
              </p>
            </div>

            <CardContent className="space-y-4 p-6">
              <div className="text-center">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Amount Paid
                </div>
                <div className="mt-1 text-3xl font-bold text-foreground">
                  {fmt(receipt.amount, receipt.currency)}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                <Row label="Merchant" value={merchant.name} />
                <Row label="Reference" value={receipt.reference ?? '—'} mono />
                <Row label="Method" value={receipt.method ?? '—'} />
                <Row label="Date" value={fmtDate(receipt.settledAt ?? receipt.createdAt)} />
                <Row
                  label="Receipt #"
                  value={receipt.id.slice(-12).toUpperCase()}
                  mono
                />
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.print()}
              >
                Print receipt
              </Button>
            </CardContent>

            <div className="border-t bg-muted/10 p-3 text-center">
              <p className="text-[9px] text-muted-foreground">
                Powered by PaySwap · Secured by Twin Token escrow
              </p>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ─── Default checkout screen ──────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4 dark:from-background dark:to-background">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="overflow-hidden shadow-xl">
          {/* Merchant header */}
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-white/20 backdrop-blur">
                {merchant.logoUrl ? (
                  <img
                    src={merchant.logoUrl}
                    alt={`${merchant.name} logo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold">
                    {merchant.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{merchant.name}</div>
                <div className="truncate text-xs opacity-80">
                  {merchant.country}
                </div>
              </div>
            </div>
          </div>

          {/* Amount + description */}
          <div className="border-b p-6 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Amount Due
            </div>
            <div className="mt-1 text-4xl font-bold text-foreground">
              {fmt(payment.amount, payment.currency)}
            </div>
            {payment.description && (
              <p className="mt-3 text-sm text-muted-foreground">
                {payment.description}
              </p>
            )}
            {payment.reference && (
              <div className="mt-2 text-xs text-muted-foreground">
                Ref: {payment.reference}
              </div>
            )}
          </div>

          <CardContent className="space-y-4 p-6">
            {phase === 'error' && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Something went wrong while processing your payment. Please try
                  again.
                </span>
              </div>
            )}

            <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
              <Row label="Merchant" value={merchant.name} />
              <Row label="Reference" value={payment.reference ?? '—'} mono />
              <Row label="Payment ID" value={payment.id.slice(0, 16)} mono />
            </div>

            <Button
              size="lg"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={phase === 'paying'}
              onClick={handlePay}
            >
              {phase === 'paying' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Pay {fmt(payment.amount, payment.currency)}
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-emerald-500" />
              <span>Secured by PaySwap · PCI-DSS compliant</span>
            </div>
          </CardContent>

          <div className="border-t bg-muted/10 p-3 text-center">
            <p className="text-[9px] text-muted-foreground">
              Powered by PaySwap · Secured by Twin Token escrow · Settled on
              Stellar
            </p>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`truncate text-right font-medium ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
