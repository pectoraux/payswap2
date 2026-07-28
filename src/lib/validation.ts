/**
 * Zod schemas for financial API validation. (H-4 fix.)
 *
 * All financial mutation endpoints should validate their input against
 * these schemas before processing. This prevents malformed input from
 * reaching the financial logic.
 */

import { z } from 'zod';

// ─── Common validators ─────────────────────────────────────────────────────

export const CURRENCIES = [
  'GHS', 'NGN', 'KES', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF',
  'ZAR', 'EGP', 'USD', 'EUR', 'GBP', 'BRL', 'INR', 'CNY',
] as const;

export const currencySchema = z.enum(CURRENCIES);

export const positiveAmountSchema = z
  .number()
  .positive('Amount must be positive')
  .max(10_000_000, 'Amount exceeds maximum (10,000,000)');

export const positiveAmountStringSchema = z
  .string()
  .or(z.number())
  .transform((v) => Number(v))
  .pipe(z.number().positive().max(10_000_000));

// ─── Payment schemas ───────────────────────────────────────────────────────

export const createPaymentSchema = z.object({
  amount: positiveAmountStringSchema,
  currency: currencySchema.default('GHS'),
  method: z.enum(['CARD', 'MOBILE_MONEY', 'BANK', 'QR', 'PAYMENT_LINK', 'CHECKOUT']),
  description: z.string().max(500).optional().default('Payment'),
  customerEmail: z.string().email().optional(),
  customerName: z.string().max(200).optional(),
});

// ─── Payout schemas ────────────────────────────────────────────────────────

export const createPayoutSchema = z.object({
  method: z.enum(['bank', 'mobile_money', 'onchain']),
  sourceAmount: positiveAmountStringSchema,
  sourceCurrency: currencySchema.default('GHS'),
  destinationCurrency: currencySchema.optional(),
  destination: z.string().min(1, 'Destination is required').max(500),
});

// ─── Refund schemas ────────────────────────────────────────────────────────

export const createRefundSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID is required').max(100),
  type: z.enum(['FULL', 'PARTIAL']),
  amount: positiveAmountStringSchema.optional(),
  reason: z.string().max(500).optional(),
});

// ─── Wallet schemas ────────────────────────────────────────────────────────

export const walletDepositSchema = z.object({
  amount: positiveAmountStringSchema,
  currency: currencySchema,
  source: z.enum(['BANK_CARD', 'MOBILE_MONEY', 'BANK_TRANSFER']),
  reference: z.string().max(200).optional(),
});

export const walletWithdrawSchema = z.object({
  amount: positiveAmountStringSchema,
  currency: currencySchema,
  destination: z.enum(['BANK_ACCOUNT', 'MOBILE_MONEY']),
  destinationLabel: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
});

export const walletTransferSchema = z.object({
  amount: positiveAmountStringSchema,
  currency: currencySchema,
  recipientType: z.enum(['customer', 'merchant']),
  recipientId: z.string().min(1, 'Recipient ID is required').max(100),
  note: z.string().max(200).optional(),
});

// ─── Invoice pay schema ────────────────────────────────────────────────────

export const payInvoiceSchema = z.object({
  // No body needed — the invoice ID comes from the URL
});

// ─── LP capital schema ─────────────────────────────────────────────────────

export const lpAddCapitalSchema = z.object({
  amount: positiveAmountStringSchema,
  currency: currencySchema,
  paymentMethod: z.enum(['bank_transfer', 'card', 'mobile_money']),
  sourceOfFunds: z.enum([
    'business_revenue',
    'personal_savings',
    'investment_returns',
    'other',
  ]),
  bankName: z.string().max(200).optional(),
  accountNumber: z.string().max(50).optional(),
  routingNumber: z.string().max(50).optional(),
  accountHolderName: z.string().max(200).optional(),
  cardNumber: z.string().max(20).optional(),
  expiry: z.string().max(10).optional(),
  cvv: z.string().max(4).optional(),
  cardholderName: z.string().max(200).optional(),
  provider: z.string().max(50).optional(),
  phoneNumber: z.string().max(20).optional(),
});

// ─── Treasury reserve adjustment schema ────────────────────────────────────

export const adjustReserveSchema = z.object({
  country: z.string().min(2).max(5),
  currency: currencySchema,
  amount: z.number(),
  reason: z.enum(['rebalancing', 'withdrawal', 'additional_deposit', 'risk_reduction', 'other']),
  paymentMethod: z.enum(['bank_transfer', 'card', 'mobile_money']).optional(),
  sourceOfFunds: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

// ─── Helper ────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';

/**
 * Validate a request body against a Zod schema.
 * Returns { success: true, data } or { success: false, response }.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { success: true; data: T } | { success: false; response: NextResponse } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((i) => ({
    field: i.path.join('.'),
    message: i.message,
  }));
  return {
    success: false,
    response: NextResponse.json(
      { error: 'Validation failed', errors },
      { status: 400 },
    ),
  };
}
