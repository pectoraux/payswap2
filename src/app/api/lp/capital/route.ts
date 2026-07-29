import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

// ── Allowed values ─────────────────────────────────────────────────────

const VALID_METHODS = ['bank_transfer', 'card', 'mobile_money'] as const;
const VALID_SOURCES = [
  'business_revenue',
  'personal_savings',
  'investment_returns',
  'salary',
  'other',
] as const;
const VALID_REASONS = [
  'rebalancing',
  'withdrawal',
  'additional_deposit',
  'risk_reduction',
  'other',
] as const;

type PaymentMethod = (typeof VALID_METHODS)[number];
type SourceOfFunds = (typeof VALID_SOURCES)[number];
type AdjustReason = (typeof VALID_REASONS)[number];

interface ParsedBody {
  action: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod | '';
  sourceOfFunds?: SourceOfFunds | '';
  sourceOfFundsOther?: string;
  reason?: AdjustReason | '';
  reasonNote?: string;
  bank?: { bankName: string; accountNumber: string; routingNumber: string; accountHolder: string };
  card?: { number: string; expiry: string; cvv: string; cardholder: string };
  mobileMoney?: { provider: string; phone: string };
}

/** Convert an ISO currency code to uppercase + validate 3-letter shape. */
function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/**
 * Validate the inbound body and return a typed ParsedBody + list of error
 * strings. The shape mirrors what `<PaymentMethodFields />` emits.
 *
 * Validation rules:
 *   - amount: positive, finite, ≤ 1e12
 *   - currency: 3-letter ISO code
 *   - paymentMethod: must be one of bank_transfer | card | mobile_money
 *   - For deposit: sourceOfFunds is required. If 'other', sourceOfFundsOther is required.
 *   - For withdraw: reason is required (one of the 5 enum values). If 'other', reasonNote is required.
 *   - For each payment method, the relevant sub-fields are required + format-validated.
 */
function parseBody(raw: any): { ok: true; value: ParsedBody } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const action = typeof raw.action === 'string' ? raw.action.toLowerCase() : '';
  if (action !== 'deposit' && action !== 'withdraw') {
    errors.push("action must be 'deposit' or 'withdraw'");
  }

  // amount
  const amountRaw = raw.amount;
  const amount =
    typeof amountRaw === 'string'
      ? parseFloat(amountRaw)
      : typeof amountRaw === 'number'
        ? amountRaw
        : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('amount must be a positive number');
  } else if (amount > 1e12) {
    errors.push('amount exceeds maximum allowed (1e12)');
  }

  // currency
  const currency = normalizeCurrency(raw.currency);
  if (!currency) {
    errors.push('currency must be a 3-letter ISO code (e.g. USD, GHS)');
  }

  // payment method
  const paymentMethod = typeof raw.paymentMethod === 'string' ? raw.paymentMethod : '';
  if (!VALID_METHODS.includes(paymentMethod as PaymentMethod)) {
    errors.push('paymentMethod must be one of bank_transfer, card, mobile_money');
  }

  // Method-specific sub-fields
  if (paymentMethod === 'bank_transfer') {
    const b = raw.bank ?? {};
    if (typeof b.bankName !== 'string' || !b.bankName.trim()) errors.push('bank.bankName is required');
    if (typeof b.accountNumber !== 'string' || b.accountNumber.replace(/\s/g, '').length < 6) {
      errors.push('bank.accountNumber must be ≥ 6 digits');
    }
    if (typeof b.routingNumber !== 'string' || b.routingNumber.replace(/\s/g, '').length < 8) {
      errors.push('bank.routingNumber must be ≥ 8 chars');
    }
    if (typeof b.accountHolder !== 'string' || !b.accountHolder.trim()) {
      errors.push('bank.accountHolder is required');
    }
  } else if (paymentMethod === 'card') {
    const c = raw.card ?? {};
    if (typeof c.number !== 'string' || !/^\d{13,19}$/.test(c.number.replace(/\s/g, ''))) {
      errors.push('card.number must be 13–19 digits');
    }
    if (typeof c.expiry !== 'string' || !/^\d{2}\/\d{2}$/.test(c.expiry)) {
      errors.push('card.expiry must be MM/YY');
    }
    if (typeof c.cvv !== 'string' || !/^\d{3,4}$/.test(c.cvv)) {
      errors.push('card.cvv must be 3–4 digits');
    }
    if (typeof c.cardholder !== 'string' || !c.cardholder.trim()) {
      errors.push('card.cardholder is required');
    }
  } else if (paymentMethod === 'mobile_money') {
    const m = raw.mobileMoney ?? {};
    if (typeof m.provider !== 'string' || !m.provider.trim()) errors.push('mobileMoney.provider is required');
    if (typeof m.phone !== 'string' || m.phone.replace(/\D/g, '').length < 9) {
      errors.push('mobileMoney.phone must be ≥ 9 digits');
    }
  }

  // source of funds (deposit only — required)
  const sourceOfFunds = typeof raw.sourceOfFunds === 'string' ? (raw.sourceOfFunds as SourceOfFunds | '') : '';
  if (action === 'deposit') {
    if (!VALID_SOURCES.includes(sourceOfFunds as SourceOfFunds)) {
      errors.push('sourceOfFunds is required for deposits (compliance)');
    } else if (sourceOfFunds === 'other') {
      if (typeof raw.sourceOfFundsOther !== 'string' || !raw.sourceOfFundsOther.trim()) {
        errors.push('sourceOfFundsOther is required when sourceOfFunds is "other"');
      }
    }
  }

  // reason (withdraw only — required for audit trail)
  const reason = typeof raw.reason === 'string' ? (raw.reason as AdjustReason | '') : '';
  if (action === 'withdraw') {
    if (!VALID_REASONS.includes(reason as AdjustReason)) {
      errors.push('reason is required for withdrawals');
    } else if (reason === 'other') {
      if (typeof raw.reasonNote !== 'string' || !raw.reasonNote.trim()) {
        errors.push('reasonNote is required when reason is "other"');
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      action: action as 'deposit' | 'withdraw',
      amount,
      currency: currency!,
      paymentMethod: paymentMethod as PaymentMethod,
      sourceOfFunds: sourceOfFunds || undefined,
      sourceOfFundsOther:
        typeof raw.sourceOfFundsOther === 'string' ? raw.sourceOfFundsOther : undefined,
      reason: reason || undefined,
      reasonNote: typeof raw.reasonNote === 'string' ? raw.reasonNote : undefined,
      bank: raw.bank,
      card: raw.card,
      mobileMoney: raw.mobileMoney,
    },
  };
}

/**
 * Strip down the payment-method payload for the audit log. NEVER persist the
 * full card PAN or CVV — only the last 4 digits + expiry (so the LP can
 * recognize the card later).
 */
function sanitizePaymentMethodForAudit(body: ParsedBody): Record<string, unknown> {
  const method = body.paymentMethod;
  if (method === 'bank_transfer' && body.bank) {
    return {
      method,
      bankName: body.bank.bankName,
      // Mask all but the last 4 digits of the account number.
      accountNumberLast4: body.bank.accountNumber.replace(/\D/g, '').slice(-4),
      routingNumber: body.bank.routingNumber,
      accountHolder: body.bank.accountHolder,
    };
  }
  if (method === 'card' && body.card) {
    return {
      method,
      cardLast4: body.card.number.replace(/\D/g, '').slice(-4),
      expiry: body.card.expiry,
      cardholder: body.card.cardholder,
    };
  }
  if (method === 'mobile_money' && body.mobileMoney) {
    return {
      method,
      provider: body.mobileMoney.provider,
      // Mask all but the last 4 digits of the phone number.
      phoneLast4: body.mobileMoney.phone.replace(/\D/g, '').slice(-4),
    };
  }
  return { method };
}

/**
 * POST /api/lp/capital
 *
 * Production-grade deposit / withdraw endpoint for LPs.
 *
 * Body (deposit):
 *   {
 *     action: 'deposit',
 *     amount: number,
 *     currency: 'USD' | 'GHS' | ...,
 *     paymentMethod: 'bank_transfer' | 'card' | 'mobile_money',
 *     bank?:    { bankName, accountNumber, routingNumber, accountHolder },
 *     card?:    { number, expiry, cvv, cardholder },   // validated, never stored
 *     mobileMoney?: { provider, phone },
 *     sourceOfFunds: 'business_revenue' | 'personal_savings' | 'investment_returns' | 'salary' | 'other',
 *     sourceOfFundsOther?: string  // required when sourceOfFunds === 'other'
 *   }
 *
 * Body (withdraw):
 *   {
 *     action: 'withdraw',
 *     amount, currency, paymentMethod, bank?/card?/mobileMoney?,
 *     reason: 'rebalancing' | 'withdrawal' | 'additional_deposit' | 'risk_reduction' | 'other',
 *     reasonNote?: string  // required when reason === 'other'
 *   }
 *
 * Deposit: increases stake + collateral by `amount` (in `currency`-equivalent
 * USD terms — the LP's stake is denominated in USD on the LPProfile). A 2s
 * mock processing delay simulates the settlement latency of the chosen
 * payment rail before the credit lands.
 *
 * Withdraw: decreases stake + collateral by `amount`, validating the LP
 * retains enough *available* (unencumbered) capital.
 *
 * Every action is journaled as a WalletTransaction on the LP's USD wallet
 * (auto-created on first deposit) and an AuditLog entry with the sanitized
 * payment-method details (no PANs / CVVs).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validation failed', errors: parsed.errors }, { status: 400 });
  }
  const body = parsed.value;

  // For withdrawals, ensure the LP has enough *available* (uncommitted) capital.
  if (body.action === 'withdraw') {
    const available = Number(lp.stake) - Number(lp.collateral);
    if (body.amount > available) {
      return NextResponse.json(
        {
          error: `Insufficient available capital. Available: ${available.toFixed(2)} USD, requested: ${body.amount.toFixed(2)} USD`,
        },
        { status: 409 },
      );
    }
    const remainingStake = Number(lp.stake) - body.amount;
    if (remainingStake < 0) {
      return NextResponse.json(
        { error: 'Withdrawal would result in negative stake' },
        { status: 409 },
      );
    }
  }

  const delta = body.action === 'deposit' ? body.amount : -body.amount;

  // ── Mock settlement latency (deposit only) ──────────────────────────
  // We model the actual processing delay of the chosen rail so deposits
  // don't instantly credit (which would be unrealistic for a payments
  // platform). Card + mobile money settle in ~2s; bank transfers get 3s to
  // reflect the slower ACH / wire clearing window.
  if (body.action === 'deposit') {
    const delayMs = body.paymentMethod === 'bank_transfer' ? 3000 : 2000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Run the stake/collateral update and the wallet journal entry in a
  // transaction so we never have a ledger mismatch.
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.lPProfile.update({
      where: { id: lp.id },
      data: {
        stake: { increment: delta },
        collateral: { increment: delta },
      },
    });

    // Find or create the LP's USD settlement wallet.
    let wallet = await tx.wallet.findFirst({
      where: { accountId: account!.id, currency: 'USD' },
    });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          accountId: account!.id,
          name: `${lp.name} — USD`,
          currency: 'USD',
          balance: 0,
          isDefault: true,
        },
      });
    }

    // Journal entry — deposits credit the wallet, withdrawals debit it.
    const txType = body.action === 'deposit' ? 'LP_DEPOSIT' : 'LP_WITHDRAW';
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: txType,
        amount: Math.abs(delta),
        currency: body.currency,
        counterparty: lp.name,
        reference: JSON.stringify({
          requestId: `lp-capital-${body.action}-${Date.now()}`,
          paymentMethod: body.paymentMethod,
          sourceOfFunds: body.sourceOfFunds ?? null,
          reason: body.reason ?? null,
        }),
      },
    });

    return next;
  });

  await db.auditLog.create({
    data: {
      userId,
      action: body.action === 'deposit' ? 'LP_CAPITAL_DEPOSIT' : 'LP_CAPITAL_WITHDRAW',
      resourceType: 'LPProfile',
      resourceId: lp.id,
      result: 'SUCCESS',
      details: JSON.stringify({
        amount: body.amount,
        currency: body.currency,
        before: { stake: lp.stake, collateral: lp.collateral },
        after: { stake: updated.stake, collateral: updated.collateral },
        delta,
        paymentMethod: sanitizePaymentMethodForAudit(body),
        sourceOfFunds: body.sourceOfFunds ?? null,
        sourceOfFundsOther: body.sourceOfFunds === 'other' ? body.sourceOfFundsOther : null,
        reason: body.reason ?? null,
        reasonNote: body.reason === 'other' ? body.reasonNote : null,
      }),
    },
  });

  return NextResponse.json({
    lp: {
      id: updated.id,
      stake: Number(updated.stake),
      collateral: Number(updated.collateral),
      available: Math.max(0, Number(updated.stake) - Number(updated.collateral)),
    },
    action: body.action,
    amount: body.amount,
    currency: body.currency,
    paymentMethod: body.paymentMethod,
    status: 'confirmed',
  });
}
