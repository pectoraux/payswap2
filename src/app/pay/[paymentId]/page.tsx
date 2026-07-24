'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, Clock, Loader2, AlertCircle, Copy, QrCode } from 'lucide-react';

interface PaymentData {
  paymentId: string;
  state: string;
  settled: boolean;
  merchant: string;
  amount: number;
  currency: string;
  reference?: string;
  lpId?: string;
  escrowId?: string;
  settlementTimeMs?: number;
  error?: string;
}

export default function HostedCheckoutPage({ params }: { params: { paymentId: string } }) {
  const [data, setData] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // In production: fetch payment status from API
    // For now: simulate a completed payment
    setTimeout(() => {
      setData({
        paymentId: params.paymentId,
        state: 'settled',
        settled: true,
        merchant: 'merchant_1',
        amount: 500,
        currency: 'GHS',
        reference: 'INV-102',
        lpId: 'lp_1',
        escrowId: 'escrow_test',
        settlementTimeMs: 2,
      });
      setLoading(false);
    }, 1000);
  }, [params.paymentId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <Skeleton className="h-8 w-full mb-4" />
            <Skeleton className="h-16 w-full mb-4" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-rose-500" />
            <p className="text-sm text-muted-foreground">{error ?? 'Payment not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stateConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
    settled: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Payment Complete' },
    escrow_frozen: { icon: Clock, color: 'text-amber-500', label: 'Awaiting Settlement' },
    merchant_confirming: { icon: Loader2, color: 'text-sky-500', label: 'Confirming...' },
    failed: { icon: AlertCircle, color: 'text-rose-500', label: 'Payment Failed' },
    intent_created: { icon: Clock, color: 'text-muted-foreground', label: 'Pending' },
  };

  const config = stateConfig[data.state] ?? stateConfig.intent_created;
  const Icon = config.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-background dark:to-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="overflow-hidden shadow-xl">
          {/* Header */}
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur">
                <span className="text-lg font-bold">P</span>
              </div>
              <div>
                <div className="text-lg font-bold">PaySwap</div>
                <div className="text-xs opacity-80">Cross-border payment</div>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="border-b p-6 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Amount Due</div>
            <div className="mt-1 text-4xl font-bold text-foreground">
              {data.amount.toLocaleString()} <span className="text-2xl text-muted-foreground">{data.currency}</span>
            </div>
            {data.reference && (
              <div className="mt-1 text-xs text-muted-foreground">Ref: {data.reference}</div>
            )}
          </div>

          {/* Status */}
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full ${data.settled ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                <Icon className={`h-6 w-6 ${config.color} ${data.state === 'merchant_confirming' ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <div className="text-base font-semibold">{config.label}</div>
                <div className="text-xs text-muted-foreground">
                  {data.settled
                    ? `Settled in ${data.settlementTimeMs ?? 0}ms`
                    : 'Processing your payment...'}
                </div>
              </div>
            </div>

            {/* Payment details */}
            <div className="mt-4 space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Merchant</span>
                <span className="font-mono">{data.merchant}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Payment ID</span>
                <span className="font-mono">{data.paymentId.slice(0, 16)}…</span>
              </div>
              {data.lpId && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Settled via</span>
                  <span className="font-mono">LP {data.lpId}</span>
                </div>
              )}
              {data.escrowId && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Escrow</span>
                  <span className="font-mono">{data.escrowId.slice(0, 16)}…</span>
                </div>
              )}
            </div>

            {/* QR placeholder */}
            {!data.settled && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <div className="flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30">
                  <QrCode className="h-16 w-16 text-muted-foreground/30" />
                </div>
                <p className="text-[10px] text-muted-foreground">Scan to pay with mobile money</p>
              </div>
            )}

            {/* Settled confirmation */}
            {data.settled && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center"
              >
                <CheckCircle2 className="mx-auto mb-1 h-8 w-8 text-emerald-500" />
                <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Payment settled successfully
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Twin Tokens released · Escrow closed · Events emitted
                </div>
              </motion.div>
            )}

            {/* Copy button */}
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full text-xs"
              onClick={() => navigator.clipboard.writeText(data.paymentId)}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy Payment ID
            </Button>
          </div>

          {/* Footer */}
          <div className="border-t bg-muted/10 p-3 text-center">
            <p className="text-[9px] text-muted-foreground">
              Powered by PaySwap · Secured by Twin Token escrow · Settled on Stellar
            </p>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
