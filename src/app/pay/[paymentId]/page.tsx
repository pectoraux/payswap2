import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { CheckoutForm } from './checkout-form';
import { PaymentLinkCheckoutForm } from './payment-link-checkout-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hosted checkout page — `/pay/[paymentId]`.
 *
 * Resolves the route param in two steps:
 *
 *   1. Try to find a `Payment` by ID — this is the original checkout flow.
 *   2. If no Payment exists, try to find a `PaymentLink` by ID — payment links
 *      share the same URL shape (`/pay/{paymentLinkId}`) and need a slightly
 *      different UX (they create + complete a fresh Payment when "Pay Now" is
 *      clicked).
 *
 * Renders dedicated states for missing and already-completed payments so the
 * customer always lands on a useful screen.
 */
export default async function HostedCheckoutPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { merchant: true },
  });

  // ─── Try a PaymentLink if no Payment matched ────────────────────────────
  if (!payment || !payment.merchant) {
    const link = await db.paymentLink.findUnique({
      where: { id: paymentId },
      include: { merchant: true },
    });

    if (link && link.merchant && link.status === 'ACTIVE') {
      // Honour the link's own expiry.
      const expired =
        link.expiresAt && new Date(link.expiresAt).getTime() < Date.now();

      if (expired) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
                  <AlertCircle className="h-8 w-8 text-amber-500" />
                </div>
                <h1 className="text-lg font-semibold">Payment link expired</h1>
                <p className="max-w-xs text-sm text-muted-foreground">
                  This payment link is no longer accepting payments. Please
                  contact the merchant for a new link.
                </p>
              </CardContent>
            </Card>
          </div>
        );
      }

      return (
        <PaymentLinkCheckoutForm
          link={{
            id: link.id,
            amount: Number(link.amount),
            currency: link.currency,
            description: link.description,
            reference: link.reference,
          }}
          merchant={{
            id: link.merchant.id,
            name: link.merchant.name,
            email: link.merchant.email,
            logoUrl: link.merchant.logoUrl,
            country: link.merchant.country,
          }}
        />
      );
    }

    // ─── Neither Payment nor PaymentLink found ───────────────────────────
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
              <AlertCircle className="h-8 w-8 text-rose-500" />
            </div>
            <h1 className="text-lg font-semibold">Payment not found</h1>
            <p className="max-w-xs text-sm text-muted-foreground">
              This payment link is invalid or has been removed. Please check the
              link and try again, or contact the merchant for assistance.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── 2. Already completed ───────────────────────────────────────────────
  if (payment.status === 'COMPLETED') {
    const fmt = (n: number, c: string) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: c,
      }).format(n);

    const fmtDate = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(d));

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4 dark:from-background dark:to-background">
        <Card className="w-full max-w-md overflow-hidden shadow-xl">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-center text-white">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-bold">Payment Already Complete</h2>
            <p className="mt-1 text-xs opacity-90">
              This payment has already been completed.
            </p>
          </div>
          <CardContent className="space-y-4 p-6">
            <div className="text-center">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Amount Paid
              </div>
              <div className="mt-1 text-3xl font-bold text-foreground">
                {fmt(Number(payment.amount), payment.currency)}
              </div>
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Merchant</span>
                <span className="truncate text-right font-medium">
                  {payment.merchant.name}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Reference</span>
                <span className="truncate text-right font-mono">
                  {payment.reference ?? '—'}
                </span>
              </div>
              {payment.settledAt && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Settled</span>
                  <span className="truncate text-right font-medium">
                    {fmtDate(payment.settledAt)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Receipt #</span>
                <span className="truncate text-right font-mono">
                  {payment.id.slice(-12).toUpperCase()}
                </span>
              </div>
            </div>
          </CardContent>
          <div className="border-t bg-muted/10 p-3 text-center">
            <p className="text-[9px] text-muted-foreground">
              Powered by PaySwap · Secured by Twin Token escrow
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ─── 3. Active checkout ─────────────────────────────────────────────────
  return (
    <CheckoutForm
      payment={{
        id: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency,
        description: payment.description,
        reference: payment.reference,
        method: payment.method,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        settledAt: payment.settledAt?.toISOString() ?? null,
      }}
      merchant={{
        id: payment.merchant.id,
        name: payment.merchant.name,
        email: payment.merchant.email,
        logoUrl: payment.merchant.logoUrl,
        country: payment.merchant.country,
      }}
    />
  );
}
