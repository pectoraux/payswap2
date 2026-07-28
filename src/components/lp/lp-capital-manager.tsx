'use client';

import * as React from 'react';
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertCircle,
  Check,
  Info,
  Scale,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CurrencySelect } from '@/components/lp/currency-select';
import { FieldHelp } from '@/components/lp/field-help';
import {
  PaymentMethodFields,
  emptyPaymentMethod,
  validatePaymentMethod,
  type PaymentMethodValue,
  type PaymentMethodErrors,
} from '@/components/lp/payment-method-fields';

export interface LpCapitalSnapshot {
  stake: number;
  collateral: number;
  available: number;
}

const ADJUST_REASONS = [
  { value: 'rebalancing', label: 'Rebalancing', requiresPayment: false, requiresSource: false, direction: 'none' as const },
  { value: 'withdrawal', label: 'Withdrawal', requiresPayment: true, requiresSource: false, direction: 'down' as const },
  { value: 'additional_deposit', label: 'Additional deposit', requiresPayment: true, requiresSource: true, direction: 'up' as const },
  { value: 'risk_reduction', label: 'Risk reduction', requiresPayment: true, requiresSource: false, direction: 'down' as const },
  { value: 'other', label: 'Other (specify)', requiresPayment: false, requiresSource: false, direction: 'none' as const },
] as const;

type AdjustReason = (typeof ADJUST_REASONS)[number]['value'];

function fmtCurrency(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * LpCapitalManager — the LP's deposit / withdraw / reserve-adjust console.
 *
 * Three tabs:
 *   1. Add Capital (deposit)  — requires payment method + source of funds.
 *                              Mocks a 2s settlement delay before crediting.
 *   2. Withdraw               — requires payment method + structured reason.
 *   3. Adjust Reserve         — reason + (conditionally) payment method +
 *                              confirmation step showing before / after /
 *                              delta. Audit-logged with full reason metadata.
 *
 * All three call the same `POST /api/lp/capital` endpoint with a richer
 * payload than the original mock form (which took only `action` + `amount`).
 */
export function LpCapitalManager({ lp }: { lp: LpCapitalSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Capital management</CardTitle>
        <CardDescription>
          Add capital, withdraw earnings, or adjust your posted reserve. Every
          action is journaled to the audit log with the payment-method details
          and compliance metadata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="deposit">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="deposit" className="gap-1.5">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Add capital</span>
              <span className="sm:hidden">Add</span>
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="gap-1.5">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Withdraw</span>
              <span className="sm:hidden">Out</span>
            </TabsTrigger>
            <TabsTrigger value="reserve" className="gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Adjust reserve</span>
              <span className="sm:hidden">Reserve</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="mt-4">
            <DepositForm lp={lp} />
          </TabsContent>

          <TabsContent value="withdraw" className="mt-4">
            <WithdrawForm lp={lp} />
          </TabsContent>

          <TabsContent value="reserve" className="mt-4">
            <AdjustReserveForm lp={lp} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── Deposit form (Add Capital) ─────────────────────────────────────────

function DepositForm({ lp }: { lp: LpCapitalSnapshot }) {
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [payment, setPayment] = React.useState<PaymentMethodValue>(emptyPaymentMethod());
  const [errors, setErrors] = React.useState<PaymentMethodErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    const errs = validatePaymentMethod(payment, { requireSourceOfFunds: true });
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please complete the payment method and source of funds fields');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/lp/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deposit',
          amount: amt,
          currency,
          paymentMethod: payment.method,
          bank: payment.bank,
          card: payment.card,
          mobileMoney: payment.mobileMoney,
          sourceOfFunds: payment.sourceOfFunds,
          sourceOfFundsOther: payment.sourceOfFundsOther,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.errors?.length ? data.errors.join(' · ') : data?.error || 'Failed to deposit';
        throw new Error(msg);
      }
      toast.success(`Deposited ${fmtCurrency(amt, currency)} to your stake`, {
        description: `Settled via ${payment.method.replace('_', ' ')}. Stake is now ${fmtCurrency(data.lp.stake)}.`,
      });
      setAmount('');
      setPayment(emptyPaymentMethod());
      setErrors({});
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deposit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Amount + currency */}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="deposit-amount" className="text-xs uppercase tracking-wide text-muted-foreground">
              Amount
            </Label>
            <FieldHelp
              title="Deposit amount"
              description="How much capital you want to commit to your LP stake. This becomes immediately available as collateral — the protocol can route new payments through it."
              example="e.g., 50000 USD adds $50,000 to your stake."
            />
          </div>
          <Input
            id="deposit-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 50000"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Currency</Label>
            <FieldHelp
              title="Deposit currency"
              description="The currency your funds are denominated in. The protocol converts to USD for stake accounting at the prevailing FX rate."
              example="e.g., GHS for Ghanaian Cedi — a 50,000 GHS deposit credits ≈ $3,800 USD to your stake."
            />
          </div>
          <CurrencySelect value={currency} onValueChange={setCurrency} size="md" />
        </div>
      </div>

      <PaymentMethodFields
        value={payment}
        onChange={setPayment}
        errors={errors}
        requireSourceOfFunds
      />

      <div className="rounded-lg border bg-emerald-500/[0.04] p-3 text-[11px] text-emerald-700 dark:text-emerald-300">
        <div className="flex items-center gap-1.5 font-medium">
          <Info className="h-3.5 w-3.5" />
          Current stake: {fmtCurrency(lp.stake)} · Available: {fmtCurrency(lp.available)}
        </div>
        <p className="mt-1 text-emerald-700/80 dark:text-emerald-300/80">
          Deposits credit instantly for card / mobile money, or within 1–3 business days for bank transfers.
        </p>
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing deposit…
          </>
        ) : (
          <>
            <ArrowDownToLine className="mr-2 h-4 w-4" /> Add capital
          </>
        )}
      </Button>
    </form>
  );
}

// ── Withdraw form ──────────────────────────────────────────────────────

function WithdrawForm({ lp }: { lp: LpCapitalSnapshot }) {
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [reason, setReason] = React.useState<'' | AdjustReason>('');
  const [reasonNote, setReasonNote] = React.useState('');
  const [payment, setPayment] = React.useState<PaymentMethodValue>(emptyPaymentMethod());
  const [errors, setErrors] = React.useState<PaymentMethodErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    if (amt > lp.available) {
      toast.error(`Insufficient available capital. Available: ${fmtCurrency(lp.available)}`);
      return;
    }
    if (!reason) {
      toast.error('Pick a reason for the withdrawal');
      return;
    }
    if (reason === 'other' && !reasonNote.trim()) {
      toast.error('Describe the reason for the withdrawal');
      return;
    }
    const errs = validatePaymentMethod(payment, { requireSourceOfFunds: false });
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please complete the payment method fields for delivery');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/lp/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw',
          amount: amt,
          currency,
          paymentMethod: payment.method,
          bank: payment.bank,
          card: payment.card,
          mobileMoney: payment.mobileMoney,
          reason,
          reasonNote: reason === 'other' ? reasonNote.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.errors?.length ? data.errors.join(' · ') : data?.error || 'Failed to withdraw';
        throw new Error(msg);
      }
      toast.success(`Withdrew ${fmtCurrency(amt, currency)} from your stake`, {
        description: `Delivered via ${payment.method.replace('_', ' ')}. Remaining stake: ${fmtCurrency(data.lp.stake)}.`,
      });
      setAmount('');
      setReason('');
      setReasonNote('');
      setPayment(emptyPaymentMethod());
      setErrors({});
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to withdraw');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="withdraw-amount" className="text-xs uppercase tracking-wide text-muted-foreground">
              Amount
            </Label>
            <FieldHelp
              title="Withdrawal amount"
              description="How much capital you want to pull out of your stake. You can only withdraw the *available* (unencumbered) portion — capital currently locked as collateral against open positions cannot be removed until those positions settle."
              example={`e.g., up to ${fmtCurrency(lp.available)} is withdrawable right now.`}
            />
          </div>
          <Input
            id="withdraw-amount"
            type="number"
            min="0"
            max={lp.available}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`up to ${fmtCurrency(lp.available)}`}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Currency</Label>
          <CurrencySelect value={currency} onValueChange={setCurrency} size="md" />
        </div>
      </div>

      {/* Reason */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="withdraw-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
            Reason
          </Label>
          <FieldHelp
            title="Withdrawal reason"
            description="PaySwap audits every capital outflow. Select the reason that best describes this withdrawal — it's logged on your audit trail alongside the payment method used for delivery."
            example="e.g., 'risk_reduction' when you're pulling capital out due to a market event."
          />
        </div>
        <Select value={reason || undefined} onValueChange={(v) => setReason(v as AdjustReason)}>
          <SelectTrigger id="withdraw-reason" className="w-full">
            <SelectValue placeholder="Pick a reason…" />
          </SelectTrigger>
          <SelectContent>
            {ADJUST_REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reason === 'other' && (
          <Textarea
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Describe the reason for this withdrawal (required for audit log)."
            rows={2}
            maxLength={300}
          />
        )}
      </div>

      <PaymentMethodFields
        value={payment}
        onChange={setPayment}
        errors={errors}
        requireSourceOfFunds={false}
        hideSourceOfFunds
      />

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Available to withdraw</span>
        <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {fmtCurrency(lp.available)}
        </span>
      </div>

      {lp.available === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            All of your stake is currently committed as collateral against open
            positions. Settle those positions before withdrawing.
          </span>
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting || lp.available === 0}
        variant="outline"
        className="w-full border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Withdrawing…
          </>
        ) : (
          <>
            <ArrowUpFromLine className="mr-2 h-4 w-4" /> Withdraw capital
          </>
        )}
      </Button>
    </form>
  );
}

// ── Adjust Reserve form ────────────────────────────────────────────────

function AdjustReserveForm({ lp }: { lp: LpCapitalSnapshot }) {
  const [direction, setDirection] = React.useState<'up' | 'down' | 'none'>('none');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [reason, setReason] = React.useState<'' | AdjustReason>('');
  const [reasonNote, setReasonNote] = React.useState('');
  const [payment, setPayment] = React.useState<PaymentMethodValue>(emptyPaymentMethod());
  const [errors, setErrors] = React.useState<PaymentMethodErrors>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const reasonMeta = ADJUST_REASONS.find((r) => r.value === reason);
  const requiresPayment = reasonMeta?.requiresPayment ?? false;
  const requiresSource = reasonMeta?.requiresSource ?? false;

  const amt = parseFloat(amount);
  const amtValid = Number.isFinite(amt) && amt > 0;

  // Compute the proposed new reserve for the confirmation dialog.
  const delta =
    direction === 'up' ? Math.abs(amt) : direction === 'down' ? -Math.abs(amt) : 0;
  const proposedStake = lp.stake + delta;
  const proposedCollateral = lp.collateral + delta;
  const proposedAvailable = Math.max(0, proposedStake - proposedCollateral);

  function handleReasonChange(v: AdjustReason) {
    setReason(v);
    const meta = ADJUST_REASONS.find((r) => r.value === v);
    setDirection(meta?.direction ?? 'none');
    // Clear payment method if the reason no longer requires one.
    if (!meta?.requiresPayment) {
      setPayment(emptyPaymentMethod());
      setErrors({});
    }
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!amtValid) {
      toast.error('Enter a positive amount');
      return;
    }
    if (!reason) {
      toast.error('Pick a reason for the adjustment');
      return;
    }
    if (reason === 'other' && !reasonNote.trim()) {
      toast.error('Describe the reason for the adjustment');
      return;
    }
    if (direction === 'down' && amt > lp.available) {
      toast.error(`Insufficient available capital. Available: ${fmtCurrency(lp.available)}`);
      return;
    }
    if (requiresPayment) {
      const opts = { requireSourceOfFunds: requiresSource };
      const errs = validatePaymentMethod(payment, opts);
      setErrors(errs);
      if (Object.keys(errs).length > 0) {
        toast.error('Please complete the payment method fields');
        return;
      }
    } else {
      setErrors({});
    }
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    setSubmitting(true);
    try {
      const action = direction === 'up' ? 'deposit' : 'withdraw';
      const res = await fetch('/api/lp/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          amount: Math.abs(amt),
          currency,
          paymentMethod: requiresPayment ? payment.method : 'bank_transfer',
          bank: requiresPayment ? payment.bank : undefined,
          card: requiresPayment ? payment.card : undefined,
          mobileMoney: requiresPayment ? payment.mobileMoney : undefined,
          sourceOfFunds: requiresSource ? payment.sourceOfFunds : undefined,
          sourceOfFundsOther: requiresSource ? payment.sourceOfFundsOther : undefined,
          reason,
          reasonNote: reason === 'other' ? reasonNote.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.errors?.length ? data.errors.join(' · ') : data?.error || 'Failed to adjust reserve';
        throw new Error(msg);
      }
      toast.success(`Reserve adjusted: ${fmtCurrency(lp.stake)} → ${fmtCurrency(data.lp.stake)}`, {
        description: `Reason: ${reasonMeta?.label}. Audit log entry created.`,
      });
      setAmount('');
      setReason('');
      setReasonNote('');
      setPayment(emptyPaymentMethod());
      setErrors({});
      setConfirmOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust reserve');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={openConfirm} className="space-y-4">
        {/* Reason picker */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="adjust-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
              Reason
            </Label>
            <FieldHelp
              title="Adjustment reason"
              description="Every reserve adjustment must be justified for the audit log. The reason you pick determines what additional fields are required — withdrawals and additional deposits need a payment method; rebalancing and 'other' are metadata-only."
              example="e.g., 'risk_reduction' when pulling capital out due to a market event; 'additional_deposit' when topping up."
            />
          </div>
          <Select value={reason || undefined} onValueChange={(v) => handleReasonChange(v as AdjustReason)}>
            <SelectTrigger id="adjust-reason" className="w-full">
              <SelectValue placeholder="Pick a reason…" />
            </SelectTrigger>
            <SelectContent>
              {ADJUST_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reason === 'other' && (
            <Textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="Describe the reason for this adjustment (required for audit log)."
              rows={2}
              maxLength={300}
            />
          )}
        </div>

        {/* Amount + currency — only shown for directional reasons */}
        {direction !== 'none' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="adjust-amount" className="text-xs uppercase tracking-wide text-muted-foreground">
                  {direction === 'up' ? 'Deposit amount' : 'Withdrawal amount'}
                </Label>
                <FieldHelp
                  title="Adjustment amount"
                  description={
                    direction === 'up'
                      ? "How much capital to add to your reserve. This becomes immediately available as collateral for new routed payments."
                      : "How much capital to remove from your reserve. You can only withdraw the available (unencumbered) portion — capital locked against open positions must wait until those positions settle."
                  }
                  example={
                    direction === 'up'
                      ? 'e.g., 25000 USD adds $25,000 to your stake.'
                      : `e.g., up to ${fmtCurrency(lp.available)} is withdrawable.`
                  }
                />
              </div>
              <Input
                id="adjust-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 25000"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Currency</Label>
              <CurrencySelect value={currency} onValueChange={setCurrency} size="md" />
            </div>
          </div>
        )}

        {/* Payment method fields — conditional on reason */}
        {requiresPayment && (
          <PaymentMethodFields
            value={payment}
            onChange={setPayment}
            errors={errors}
            requireSourceOfFunds={requiresSource}
            hideSourceOfFunds={!requiresSource}
          />
        )}

        {/* Live before/after preview */}
        {direction !== 'none' && amtValid && (
          <div className="rounded-lg border bg-card/40 p-3 text-xs">
            <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
              <Scale className="h-3.5 w-3.5" />
              Reserve impact preview
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border bg-background/60 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Current</div>
                <div className="mt-0.5 font-semibold tabular-nums">{fmtCurrency(lp.stake)}</div>
              </div>
              <div className="rounded-md border bg-background/60 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Delta</div>
                <div
                  className={`mt-0.5 font-semibold tabular-nums ${
                    delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : delta < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {fmtCurrency(delta)}
                </div>
              </div>
              <div className="rounded-md border bg-emerald-500/10 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Proposed</div>
                <div className="mt-0.5 font-semibold tabular-nums">{fmtCurrency(proposedStake)}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
              <div>
                Collateral: <span className="tabular-nums">{fmtCurrency(lp.collateral)}</span> →{' '}
                <span className="tabular-nums font-medium">{fmtCurrency(proposedCollateral)}</span>
              </div>
              <div>
                Available: <span className="tabular-nums">{fmtCurrency(lp.available)}</span> →{' '}
                <span className="tabular-nums font-medium">{fmtCurrency(proposedAvailable)}</span>
              </div>
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={direction === 'none' || !amtValid || submitting}
          className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Scale className="mr-2 h-4 w-4" />
          {direction === 'up' ? 'Review deposit' : direction === 'down' ? 'Review withdrawal' : 'Pick a reason to continue'}
        </Button>
      </form>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Confirm reserve adjustment
            </DialogTitle>
            <DialogDescription>
              This action is irreversible and will be recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-lg border bg-card/40 p-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current reserve</div>
                <div className="mt-0.5 font-semibold tabular-nums">{fmtCurrency(lp.stake)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Proposed reserve</div>
                <div className="mt-0.5 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtCurrency(proposedStake)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Delta</div>
                <div
                  className={`mt-0.5 font-semibold tabular-nums ${
                    delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {fmtCurrency(delta)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</div>
                <div className="mt-0.5 font-semibold">{reasonMeta?.label}</div>
              </div>
            </div>

            {reason === 'other' && reasonNote.trim() && (
              <div className="rounded-md border bg-background/60 p-2 text-xs">
                <span className="text-muted-foreground">Note: </span>
                {reasonNote.trim()}
              </div>
            )}

            {requiresPayment && (
              <div className="rounded-md border bg-background/60 p-2 text-xs">
                <span className="text-muted-foreground">Delivery: </span>
                <span className="font-medium">{payment.method.replace('_', ' ')}</span>
              </div>
            )}

            <div className="flex items-start gap-2 border-t pt-2 text-[11px] text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                AuditLog entry will be created with your user ID, the payment method
                details (sensitive fields masked), and the structured reason.
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmSubmit}
              disabled={submitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adjusting…
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" /> Confirm adjustment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
