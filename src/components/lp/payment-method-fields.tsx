'use client';

import * as React from 'react';
import { Building2, CreditCard, Smartphone, Wallet } from 'lucide-react';
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
import { FieldHelp } from '@/components/lp/field-help';

/** The payment-method types LPs can use to fund their stake. */
export type PaymentMethodType = 'bank_transfer' | 'card' | 'mobile_money';

/** Source-of-funds categories required for AML/KYC compliance. */
export type SourceOfFunds =
  | 'business_revenue'
  | 'personal_savings'
  | 'investment_returns'
  | 'salary'
  | 'other';

/** Bank transfer payload. */
export interface BankDetails {
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  accountHolder: string;
}

/** Card payload — validated for format only, never actually charged. */
export interface CardDetails {
  number: string;
  expiry: string; // MM/YY
  cvv: string;
  cardholder: string;
}

/** Mobile money payload. */
export interface MobileMoneyDetails {
  provider: string; // MTN | Vodafone | AirtelTigo
  phone: string;
}

/** Full payment-method payload shared by Add Capital + Adjust Reserve forms. */
export interface PaymentMethodValue {
  method: PaymentMethodType | '';
  bank?: BankDetails;
  card?: CardDetails;
  mobileMoney?: MobileMoneyDetails;
  sourceOfFunds: SourceOfFunds | '';
  sourceOfFundsOther?: string;
}

/** Errors keyed by field path — used to surface validation issues inline. */
export type PaymentMethodErrors = Partial<Record<keyof PaymentMethodValue | string, string>>;

/** Returns an empty value — used by parent forms when resetting. */
export function emptyPaymentMethod(): PaymentMethodValue {
  return {
    method: '',
    sourceOfFunds: '',
    sourceOfFundsOther: '',
  };
}

// ── Mobile money providers (African focus) ─────────────────────────────
export const MOBILE_MONEY_PROVIDERS = [
  { code: 'MTN', label: 'MTN Mobile Money' },
  { code: 'VODAFONE', label: 'Vodafone Cash' },
  { code: 'AIRTELTIGO', label: 'AirtelTigo Money' },
  { code: 'ORANGE', label: 'Orange Money' },
  { code: 'MPESA', label: 'M-Pesa' },
  { code: 'OTHER', label: 'Other' },
] as const;

export const PAYMENT_METHOD_OPTIONS: {
  value: PaymentMethodType;
  label: string;
  description: string;
  icon: typeof Building2;
}[] = [
  {
    value: 'bank_transfer',
    label: 'Bank transfer',
    description: 'Wire from your business or personal bank account. 1–3 business days.',
    icon: Building2,
  },
  {
    value: 'card',
    label: 'Debit / credit card',
    description: 'Instant funding. Validated for format only — never actually charged.',
    icon: CreditCard,
  },
  {
    value: 'mobile_money',
    label: 'Mobile money',
    description: 'MTN, Vodafone, AirtelTigo, M-Pesa, Orange. Settles within minutes.',
    icon: Smartphone,
  },
];

export const SOURCE_OF_FUNDS_OPTIONS: { value: SourceOfFunds; label: string }[] = [
  { value: 'business_revenue', label: 'Business revenue' },
  { value: 'personal_savings', label: 'Personal savings' },
  { value: 'investment_returns', label: 'Investment returns' },
  { value: 'salary', label: 'Salary / wages' },
  { value: 'other', label: 'Other (specify)' },
];

// ── Format helpers (validation only — no PII is persisted) ─────────────

/** Strip everything except digits. */
function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}

/** Format a card number as "4242 4242 4242 4242" while typing. */
function formatCardNumber(raw: string): string {
  const d = digitsOnly(raw).slice(0, 19);
  return d.replace(/(.{4})/g, '$1 ').trim();
}

/** Format expiry as MM/YY while typing. */
function formatExpiry(raw: string): string {
  const d = digitsOnly(raw).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** Luhn check — returns true if the card number (digits only) is valid. */
function luhnValid(num: string): boolean {
  const d = digitsOnly(num);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i], 10);
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Validate expiry MM/YY — must be a valid month (01–12) and not in the past. */
function expiryValid(raw: string): boolean {
  const m = raw.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const mm = parseInt(m[1], 10);
  const yy = parseInt(m[2], 10);
  if (mm < 1 || mm > 12) return false;
  // Treat YY as 20YY. Expires end of month mm / 20yy.
  const exp = new Date(2000 + yy, mm, 1); // first day of next month
  return exp.getTime() > Date.now();
}

/** Format a phone number for display (Ghana-style: +233 24 123 4567). */
function formatPhone(raw: string): string {
  const d = digitsOnly(raw).slice(0, 15);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 10)} ${d.slice(10)}`.trim();
}

/**
 * Validate a full PaymentMethodValue. Returns a map of field → message; an
 * empty object means the payload is OK to submit.
 *
 * Used by Add Capital (deposits always require source of funds) and by
 * Adjust Reserve (withdrawals skip source-of-funds; additional deposits
 * require it).
 */
export function validatePaymentMethod(
  v: PaymentMethodValue,
  opts: { requireSourceOfFunds?: boolean } = {},
): PaymentMethodErrors {
  const errs: PaymentMethodErrors = {};
  if (!v.method) {
    errs.method = 'Pick a payment method.';
    return errs;
  }
  if (v.method === 'bank_transfer') {
    const b = v.bank;
    if (!b?.bankName?.trim()) errs['bank.bankName'] = 'Bank name is required.';
    if (!b?.accountNumber?.trim() || b.accountNumber.replace(/\s/g, '').length < 6) {
      errs['bank.accountNumber'] = 'Enter a valid account number (≥ 6 digits).';
    }
    if (!b?.routingNumber?.trim() || digitsOnly(b.routingNumber).length < 8) {
      errs['bank.routingNumber'] = 'Routing / SWIFT code must be ≥ 8 chars.';
    }
    if (!b?.accountHolder?.trim()) errs['bank.accountHolder'] = 'Account holder is required.';
  } else if (v.method === 'card') {
    const c = v.card;
    if (!c?.number?.trim() || !luhnValid(c.number)) {
      errs['card.number'] = 'Enter a valid 13–19 digit card number.';
    }
    if (!c?.expiry?.trim() || !expiryValid(c.expiry)) {
      errs['card.expiry'] = 'Use MM/YY — must be a future month.';
    }
    if (!c?.cvv?.trim() || digitsOnly(c.cvv).length < 3) {
      errs['card.cvv'] = 'CVV must be 3–4 digits.';
    }
    if (!c?.cardholder?.trim()) errs['card.cardholder'] = 'Cardholder name is required.';
  } else if (v.method === 'mobile_money') {
    const m = v.mobileMoney;
    if (!m?.provider) errs['mobileMoney.provider'] = 'Pick a mobile money provider.';
    if (!m?.phone?.trim() || digitsOnly(m.phone).length < 9) {
      errs['mobileMoney.phone'] = 'Enter a valid phone number (≥ 9 digits).';
    }
  }
  if (opts.requireSourceOfFunds !== false) {
    if (!v.sourceOfFunds) {
      errs.sourceOfFunds = 'Source of funds is required for compliance.';
    } else if (v.sourceOfFunds === 'other' && !v.sourceOfFundsOther?.trim()) {
      errs.sourceOfFundsOther = 'Describe the source of funds.';
    }
  }
  return errs;
}

// ── Component ──────────────────────────────────────────────────────────

export interface PaymentMethodFieldsProps {
  value: PaymentMethodValue;
  onChange: (next: PaymentMethodValue) => void;
  errors?: PaymentMethodErrors;
  /** When true (default), the source-of-funds field is shown + required. */
  requireSourceOfFunds?: boolean;
  /** Hide the source-of-funds selector entirely (e.g. for withdrawals). */
  hideSourceOfFunds?: boolean;
  /** Disable every field. */
  disabled?: boolean;
}

/**
 * `<PaymentMethodFields />` — renders a payment-method picker + the
 * appropriate conditional field set (bank, card, or mobile money) plus an
 * optional source-of-funds compliance selector.
 *
 * Reused by both the Add Capital form (deposits always require source of
 * funds) and the Adjust Reserve form (deposits require it; withdrawals hide
 * it entirely). Parent forms own the value state and call
 * `validatePaymentMethod()` before submitting.
 */
export function PaymentMethodFields({
  value,
  onChange,
  errors = {},
  requireSourceOfFunds = true,
  hideSourceOfFunds = false,
  disabled = false,
}: PaymentMethodFieldsProps) {
  function patch(next: Partial<PaymentMethodValue>) {
    onChange({ ...value, ...next });
  }
  function patchBank(next: Partial<BankDetails>) {
    onChange({ ...value, bank: { ...(value.bank ?? { bankName: '', accountNumber: '', routingNumber: '', accountHolder: '' }), ...next } });
  }
  function patchCard(next: Partial<CardDetails>) {
    onChange({ ...value, card: { ...(value.card ?? { number: '', expiry: '', cvv: '', cardholder: '' }), ...next } });
  }
  function patchMobile(next: Partial<MobileMoneyDetails>) {
    onChange({ ...value, mobileMoney: { ...(value.mobileMoney ?? { provider: '', phone: '' }), ...next } });
  }

  const showSourceOfFunds = !hideSourceOfFunds;

  return (
    <div className="space-y-4">
      {/* Payment-method picker */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="pm-method" className="text-xs uppercase tracking-wide text-muted-foreground">
            Payment method
          </Label>
          <FieldHelp
            title="Payment method"
            description="How you'll move funds in or out of your LP stake. Each method has different settlement speed and compliance requirements."
            example="e.g., Bank transfer for large USD deposits; mobile money for instant GHS top-ups."
          />
        </div>
        <Select
          value={value.method || undefined}
          onValueChange={(m) => patch({ method: m as PaymentMethodType })}
          disabled={disabled}
        >
          <SelectTrigger id="pm-method" className="w-full">
            <SelectValue placeholder="Choose how to pay…" />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHOD_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="font-medium">{opt.label}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {errors.method && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors.method}</p>}
        {value.method && (
          <p className="text-[11px] text-muted-foreground">
            {PAYMENT_METHOD_OPTIONS.find((o) => o.value === value.method)?.description}
          </p>
        )}
      </div>

      {/* Bank transfer fields */}
      {value.method === 'bank_transfer' && (
        <div className="grid gap-3 rounded-lg border bg-card/40 p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bank-name" className="text-xs">Bank name</Label>
            <Input
              id="bank-name"
              value={value.bank?.bankName ?? ''}
              onChange={(e) => patchBank({ bankName: e.target.value })}
              placeholder="e.g., Standard Chartered Bank Ghana"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['bank.bankName'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['bank.bankName']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-acct" className="text-xs">Account number</Label>
            <Input
              id="bank-acct"
              value={value.bank?.accountNumber ?? ''}
              onChange={(e) => patchBank({ accountNumber: digitsOnly(e.target.value).slice(0, 20) })}
              placeholder="e.g., 0123456789012"
              inputMode="numeric"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['bank.accountNumber'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['bank.accountNumber']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-routing" className="text-xs">Routing / SWIFT / IBAN</Label>
            <Input
              id="bank-routing"
              value={value.bank?.routingNumber ?? ''}
              onChange={(e) => patchBank({ routingNumber: e.target.value.toUpperCase().slice(0, 34) })}
              placeholder="e.g., SCBLGHAC or 026001022"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['bank.routingNumber'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['bank.routingNumber']}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bank-holder" className="text-xs">Account holder name</Label>
            <Input
              id="bank-holder"
              value={value.bank?.accountHolder ?? ''}
              onChange={(e) => patchBank({ accountHolder: e.target.value })}
              placeholder="e.g., Acme Liquidity LLC"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['bank.accountHolder'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['bank.accountHolder']}</p>}
          </div>
        </div>
      )}

      {/* Card fields */}
      {value.method === 'card' && (
        <div className="grid gap-3 rounded-lg border bg-card/40 p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="card-number" className="text-xs">Card number</Label>
            <Input
              id="card-number"
              value={value.card?.number ?? ''}
              onChange={(e) => patchCard({ number: formatCardNumber(e.target.value) })}
              placeholder="4242 4242 4242 4242"
              inputMode="numeric"
              disabled={disabled}
              autoComplete="off"
              className="font-mono tabular-nums"
            />
            {errors['card.number'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['card.number']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-expiry" className="text-xs">Expiry (MM/YY)</Label>
            <Input
              id="card-expiry"
              value={value.card?.expiry ?? ''}
              onChange={(e) => patchCard({ expiry: formatExpiry(e.target.value) })}
              placeholder="08/29"
              inputMode="numeric"
              disabled={disabled}
              autoComplete="off"
              className="font-mono tabular-nums"
            />
            {errors['card.expiry'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['card.expiry']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="card-cvv" className="text-xs">CVV</Label>
            <Input
              id="card-cvv"
              value={value.card?.cvv ?? ''}
              onChange={(e) => patchCard({ cvv: digitsOnly(e.target.value).slice(0, 4) })}
              placeholder="123"
              inputMode="numeric"
              disabled={disabled}
              autoComplete="off"
              type="password"
              className="font-mono tabular-nums"
            />
            {errors['card.cvv'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['card.cvv']}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="card-holder" className="text-xs">Cardholder name</Label>
            <Input
              id="card-holder"
              value={value.card?.cardholder ?? ''}
              onChange={(e) => patchCard({ cardholder: e.target.value })}
              placeholder="e.g., Jane Doe"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['card.cardholder'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['card.cardholder']}</p>}
          </div>
          <p className="sm:col-span-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Wallet className="h-3 w-3" />
            Card details are validated for format only — never stored or charged.
          </p>
        </div>
      )}

      {/* Mobile money fields */}
      {value.method === 'mobile_money' && (
        <div className="grid gap-3 rounded-lg border bg-card/40 p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mm-provider" className="text-xs">Provider</Label>
            <Select
              value={value.mobileMoney?.provider ?? undefined}
              onValueChange={(p) => patchMobile({ provider: p })}
              disabled={disabled}
            >
              <SelectTrigger id="mm-provider" className="w-full">
                <SelectValue placeholder="Pick a provider…" />
              </SelectTrigger>
              <SelectContent>
                {MOBILE_MONEY_PROVIDERS.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors['mobileMoney.provider'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['mobileMoney.provider']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mm-phone" className="text-xs">Phone number</Label>
            <Input
              id="mm-phone"
              value={value.mobileMoney?.phone ?? ''}
              onChange={(e) => patchMobile({ phone: formatPhone(e.target.value) })}
              placeholder="e.g., +233 24 123 4567"
              inputMode="tel"
              disabled={disabled}
              autoComplete="off"
            />
            {errors['mobileMoney.phone'] && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors['mobileMoney.phone']}</p>}
          </div>
        </div>
      )}

      {/* Source of funds (compliance) */}
      {showSourceOfFunds && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="pm-sof" className="text-xs uppercase tracking-wide text-muted-foreground">
              Source of funds
            </Label>
            <FieldHelp
              title="Source of funds"
              description="PaySwap is required by AML/KYC regulations to record where LP capital originates. This is logged on the audit trail and reviewed by compliance."
              example="e.g., business_revenue for treasury deposits from an operating company."
            />
          </div>
          <Select
            value={value.sourceOfFunds || undefined}
            onValueChange={(s) => patch({ sourceOfFunds: s as SourceOfFunds })}
            disabled={disabled}
          >
            <SelectTrigger id="pm-sof" className="w-full">
              <SelectValue placeholder="Select source of funds…" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OF_FUNDS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.sourceOfFunds && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors.sourceOfFunds}</p>}
          {value.sourceOfFunds === 'other' && (
            <div className="space-y-1.5">
              <Textarea
                value={value.sourceOfFundsOther ?? ''}
                onChange={(e) => patch({ sourceOfFundsOther: e.target.value })}
                placeholder="Briefly describe where the funds come from (required for compliance review)."
                rows={2}
                maxLength={300}
                disabled={disabled}
              />
              {errors.sourceOfFundsOther && <p className="text-[11px] text-rose-600 dark:text-rose-400">{errors.sourceOfFundsOther}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
