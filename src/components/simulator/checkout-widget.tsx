'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, AlertCircle, QrCode, Link as LinkIcon, Zap, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface PaymentResult {
  paymentLink?: string;
  paymentId?: string;
  state?: string;
  settled?: boolean;
  merchant?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  error?: string;
}

export function CheckoutWidget() {
  const [amount, setAmount] = useState('500');
  const [currency, setCurrency] = useState('GHS');
  const [merchantId, setMerchantId] = useState('merchant_1');
  const [reference, setReference] = useState('INV-001');
  const [priority, setPriority] = useState('cheapest');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);

  const createPayment = async (type: 'payment' | 'link' | 'qr') => {
    setLoading(true);
    setResult(null);
    try {
      const endpoint = type === 'link' ? '/api/payment-links' : '/api/payments';
      const body = type === 'link'
        ? { merchantId, amount: Number(amount), currency, reference, priority }
        : { sourceAmount: Number(amount), sourceCurrency: currency, destinationCurrency: currency, senderId: 'checkout_user', receiverId: merchantId, priority };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (type === 'link') {
        setResult(data);
      } else {
        setResult({
          paymentId: data.payment?.id,
          state: data.result?.state,
          settled: data.result?.settled,
          merchant: merchantId,
          amount: Number(amount),
          currency,
          reference,
        });
      }

      toast.success(type === 'link' ? 'Payment link created' : 'Payment settled', {
        description: type === 'link' ? data.paymentLink : `${data.result?.state} · ${data.result?.settled ? 'settled' : 'pending'}`,
      });
    } catch (e) {
      toast.error('Failed to create payment');
      setResult({ error: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const generateQR = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/merchant/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'checkout', merchant: merchantId, currency, amount: Number(amount), reference }),
      });
      const data = await res.json();
      toast.success('QR code generated', { description: data.qrUrl });
      setResult({ paymentId: data.qrId, state: 'qr_generated', merchant: merchantId, amount: Number(amount), currency, reference });
    } catch {
      toast.error('Failed to generate QR');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
            <span className="text-sm font-bold">P</span>
          </div>
          <div>
            <div className="text-sm font-bold">PaySwap Checkout</div>
            <div className="text-[10px] text-muted-foreground">Merchant payment widget</div>
          </div>
        </div>

        {/* Form */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GHS" className="font-mono">GHS</SelectItem>
                <SelectItem value="KES" className="font-mono">KES</SelectItem>
                <SelectItem value="NGN" className="font-mono">NGN</SelectItem>
                <SelectItem value="USD" className="font-mono">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Merchant ID</Label>
            <Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => createPayment('payment')} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
            Pay Now
          </Button>
          <Button onClick={() => createPayment('link')} disabled={loading} variant="outline">
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LinkIcon className="mr-1 h-3 w-3" />}
            Payment Link
          </Button>
          <Button onClick={generateQR} disabled={loading} variant="outline">
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <QrCode className="mr-1 h-3 w-3" />}
            Generate QR
          </Button>
        </div>

        {/* Result */}
        {result && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {result.error ? (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600">
                <AlertCircle className="h-4 w-4" /> {result.error}
              </div>
            ) : result.state === 'qr_generated' ? (
              <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
                <QrCode className="h-4 w-4 text-sky-500" />
                <span>QR generated: {result.paymentId}</span>
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => navigator.clipboard.writeText(result.paymentId ?? '')}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ) : result.paymentLink ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <LinkIcon className="h-4 w-4 text-emerald-500" />
                  <span className="truncate font-mono text-xs">{result.paymentLink}</span>
                  <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => { navigator.clipboard.writeText(result.paymentLink ?? ''); toast.success('Link copied'); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span>State: {result.state} · Settled: {result.settled ? 'Yes' : 'No'}</span>
                </div>
              </div>
            ) : (
              <div className={`rounded-lg border p-3 ${result.settled ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                <div className="flex items-center gap-2">
                  {result.settled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Loader2 className="h-4 w-4 text-amber-500" />}
                  <span className="text-sm font-medium">{result.settled ? 'Payment Settled' : result.state}</span>
                  <Badge variant="outline" className="ml-auto text-[9px]">{result.currency}</Badge>
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">ID: {result.paymentId?.slice(0, 20)}…</div>
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
