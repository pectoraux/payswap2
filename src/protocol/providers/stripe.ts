/**
 * PaySwap Protocol — Provider Adapter — Stripe (Card PSP).
 *
 * Simulated Stripe API connector. Real implementations call the Stripe
 * REST API (api.stripe.com/v1) with a bearer API key
 * (`sk_live_...` / `sk_test_...`); this in-process simulation mirrors
 * that surface area.
 *
 * Operations:
 *   - createPaymentIntent({ amount, currency, customer?, description? }) — POST /v1/payment_intents
 *   - confirmPayment({ paymentIntentId, paymentMethod })                — POST /v1/payment_intents/{id}/confirm
 *   - createPayout({ amount, currency, destination })                   — POST /v1/payouts
 *   - getBalance({})                                                    — GET /v1/balance
 *   - createRefund({ chargeId, amount?, reason? })                      — POST /v1/refunds
 *   - createCustomer({ email, name, metadata })                         — POST /v1/customers
 *
 * Auth: Bearer API key in the `Authorization` header. Stripe accepts
 * both live (`sk_live_...`) and test (`sk_test_...`) keys; the test key
 * is sufficient for the simulated path. No OAuth2 dance required.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 * reputation=0.95, jurisdiction='US'.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid, round } from '@/kernel/support';
import type { ConnectorRequest } from '@/protocol/connectors-v2/types';
import { authFailed, invalidResponse } from '@/protocol/connectors-v2/errors';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { ProductionConnector, type DoQueryResult } from '@/protocol/connectors-v2/base';
import { asConnectorConfig, type ProviderConfig } from './types';

/** Default config — Stripe API characteristics. */
export const DEFAULT_STRIPE_CONFIG: ProviderConfig = {
  id: 'stripe',
  type: 'psp',
  name: 'Stripe',
  endpoint: 'https://api.stripe.com/v1',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 250,
  rateLimitRps: 25,
  rateLimitBurst: 50,
  idempotencyTtlMs: 24 * 60 * 1000,
  environment: 'test',
};

interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled' | 'processing';
  clientSecret: string;
  customer?: string;
  description?: string;
  charges: { id: string; amount: number; status: 'succeeded' | 'failed' | 'pending' }[];
  createdAt: number;
}

interface StripePayout {
  id: string;
  object: 'payout';
  amount: number;
  currency: string;
  destination: string;
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  arrivalDate: number;
  createdAt: number;
}

interface StripeRefund {
  id: string;
  object: 'refund';
  charge: string;
  amount: number;
  currency: string;
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'expired_uncaptured_charge';
  status: 'succeeded' | 'pending' | 'failed' | 'canceled';
  createdAt: number;
}

interface StripeCustomer {
  id: string;
  object: 'customer';
  email: string;
  name?: string;
  metadata: Record<string, string>;
  createdAt: number;
}

interface StripeBalance {
  object: 'balance';
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
  instantAvailable?: { amount: number; currency: string }[];
}

/** Convert currency to Stripe's smallest unit (e.g. cents for USD). */
function toMinorUnit(amount: number, currency: string): number {
  // Zero-decimal currencies: JPY, KRW, etc. Otherwise 2 decimals.
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'TZS'];
  const multiplier = zeroDecimal.includes(currency.toUpperCase()) ? 1 : 100;
  return Math.round(amount * multiplier);
}

function fromMinorUnit(amount: number, currency: string): number {
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'TZS'];
  const divisor = zeroDecimal.includes(currency.toUpperCase()) ? 1 : 100;
  return round(amount / divisor, 2);
}

export class StripeConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly paymentIntents = new Map<string, StripePaymentIntent>();
  private readonly payouts = new Map<string, StripePayout>();
  private readonly refunds = new Map<string, StripeRefund>();
  private readonly customers = new Map<string, StripeCustomer>();
  private readonly charges = new Map<string, { id: string; amount: number; status: 'succeeded' | 'failed' | 'pending'; paymentIntentId?: string }>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_STRIPE_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'createPaymentIntent':
        return this.createPaymentIntent(request.params);
      case 'confirmPayment':
        return this.confirmPayment(request.params);
      case 'createPayout':
        return this.createPayout(request.params);
      case 'getBalance':
        return this.getBalance(request.params);
      case 'createRefund':
        return this.createRefund(request.params);
      case 'createCustomer':
        return this.createCustomer(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['paymentIntentId'] as string | undefined) ??
      (params['chargeId'] as string | undefined) ??
      (params['customer'] as string | undefined) ??
      (params['destination'] as string | undefined) ??
      request.id;
    const amount = params['amount'] as number | undefined;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'stripe-connector',
      reputation: 0.95,
      jurisdiction: 'US',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof amount === 'number' ? round(amount, 2) : undefined,
      payload: { operation: request.operation, requestId: request.id, provider: 'stripe', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /**
   * Stripe uses a single bearer API key. Real impl sends
   * `Authorization: Bearer sk_live_xxx` on every request. We validate
   * the key shape (`sk_live_*` / `sk_test_*`) — in production this is
   * enforced by Stripe on the server side.
   */
  private authenticate(): { ok: true } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKey } = this.providerConfig;
    if (!apiKey) {
      return { ok: false, error: authFailed('stripe: apiKey required') };
    }
    if (!apiKey.startsWith('sk_')) {
      return { ok: false, error: authFailed('stripe: apiKey must start with sk_') };
    }
    return { ok: true };
  }

  // ----------------------------------------------------------- createPaymentIntent
  private createPaymentIntent(params: Record<string, unknown>): DoQueryResult {
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    const customer = params['customer'] as string | undefined;
    const description = params['description'] as string | undefined;
    if (amount === undefined) {
      return { ok: false, error: invalidResponse('amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = `pi_${uid('stripe').slice(-24)}`;
    const clientSecret = `${id}_secret_${uid('sec').slice(-16)}`;
    const pi: StripePaymentIntent = {
      id,
      object: 'payment_intent',
      amount: toMinorUnit(amount, currency),
      currency: currency.toLowerCase(),
      status: 'requires_payment_method',
      clientSecret,
      customer,
      description,
      charges: [],
      createdAt: Date.now(),
    };
    this.paymentIntents.set(id, pi);
    return { ok: true, data: pi };
  }

  // ------------------------------------------------------------- confirmPayment
  private confirmPayment(params: Record<string, unknown>): DoQueryResult {
    const paymentIntentId = params['paymentIntentId'] as string | undefined;
    const paymentMethod = (params['paymentMethod'] as string | undefined) ?? 'pm_card_visa';
    if (!paymentIntentId) {
      return { ok: false, error: invalidResponse('paymentIntentId_required') };
    }
    const pi = this.paymentIntents.get(paymentIntentId);
    if (!pi) {
      return { ok: false, error: invalidResponse(`payment_intent_not_found:${paymentIntentId}`) };
    }
    // Simulated successful confirmation.
    pi.status = 'succeeded';
    const charge = {
      id: `ch_${uid('stripe').slice(-24)}`,
      amount: pi.amount,
      status: 'succeeded' as const,
      paymentIntentId: pi.id,
    };
    this.charges.set(charge.id, charge);
    pi.charges.push({ id: charge.id, amount: charge.amount, status: 'succeeded' });
    return {
      ok: true,
      data: { ...pi, lastPaymentError: undefined, paymentMethod },
    };
  }

  // ----------------------------------------------------------------- createPayout
  private createPayout(params: Record<string, unknown>): DoQueryResult {
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    const destination = (params['destination'] as string | undefined) ?? 'default_for_currency';
    if (amount === undefined) {
      return { ok: false, error: invalidResponse('amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = `po_${uid('stripe').slice(-24)}`;
    const payout: StripePayout = {
      id,
      object: 'payout',
      amount: toMinorUnit(amount, currency),
      currency: currency.toLowerCase(),
      destination,
      status: 'pending',
      arrivalDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    };
    this.payouts.set(id, payout);
    return { ok: true, data: payout };
  }

  // ------------------------------------------------------------------- getBalance
  private getBalance(_params: Record<string, unknown>): DoQueryResult {
    const balance: StripeBalance = {
      object: 'balance',
      available: [{ amount: 1_234_567, currency: 'usd' }, { amount: 89_00, currency: 'eur' }],
      pending: [{ amount: 12_345, currency: 'usd' }],
    };
    return {
      ok: true,
      data: {
        ...balance,
        // Convenience projection with amounts in major units.
        availableMajor: balance.available.map((b) => ({ amount: fromMinorUnit(b.amount, b.currency), currency: b.currency })),
        pendingMajor: balance.pending.map((b) => ({ amount: fromMinorUnit(b.amount, b.currency), currency: b.currency })),
      },
    };
  }

  // ------------------------------------------------------------------- createRefund
  private createRefund(params: Record<string, unknown>): DoQueryResult {
    const chargeId = params['chargeId'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const reason = (params['reason'] as StripeRefund['reason'] | undefined) ?? 'requested_by_customer';
    if (!chargeId) {
      return { ok: false, error: invalidResponse('chargeId_required') };
    }
    const charge = this.charges.get(chargeId);
    if (!charge) {
      return { ok: false, error: invalidResponse(`charge_not_found:${chargeId}`) };
    }
    const refundAmount = amount !== undefined ? toMinorUnit(amount, 'USD') : charge.amount;
    if (refundAmount > charge.amount) {
      return { ok: false, error: invalidResponse('refund_exceeds_charge_amount') };
    }
    const id = `re_${uid('stripe').slice(-24)}`;
    const refund: StripeRefund = {
      id,
      object: 'refund',
      charge: chargeId,
      amount: refundAmount,
      currency: 'usd',
      reason,
      status: 'succeeded',
      createdAt: Date.now(),
    };
    this.refunds.set(id, refund);
    return { ok: true, data: refund };
  }

  // ----------------------------------------------------------------- createCustomer
  private createCustomer(params: Record<string, unknown>): DoQueryResult {
    const email = params['email'] as string | undefined;
    const name = params['name'] as string | undefined;
    const metadata = (params['metadata'] as Record<string, string> | undefined) ?? {};
    if (!email) {
      return { ok: false, error: invalidResponse('email_required') };
    }
    const id = `cus_${uid('stripe').slice(-24)}`;
    const customer: StripeCustomer = {
      id,
      object: 'customer',
      email,
      name,
      metadata,
      createdAt: Date.now(),
    };
    this.customers.set(id, customer);
    return { ok: true, data: customer };
  }
}
