/**
 * Stripe live connector — real REST API calls to Stripe's test mode.
 *
 * Operations:
 *   - createPaymentIntent: POST /v1/payment_intents
 *   - retrievePaymentIntent: GET /v1/payment_intents/:id
 *   - createCustomer: POST /v1/customers
 *
 * Auth: Bearer sk_test_...
 * Docs: https://stripe.com/docs/api/payment_intents
 */

import { requireEnv, redactKey, timed, type LiveTestResult } from './types';

const STRIPE_API = 'https://api.stripe.com/v1';

interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
  payment_method_types: string[];
  created: number;
}

interface StripeCustomer {
  id: string;
  email: string;
  name: string;
  created: number;
}

function authHeader(): string {
  return `Bearer ${requireEnv('STRIPE_SECRET_KEY')}`;
}

/** Create a Payment Intent for a test card payment. */
export async function createPaymentIntent(opts: {
  amount?: number;      // in cents
  currency?: string;    // e.g. 'usd'
} = {}): Promise<LiveTestResult<StripePaymentIntent>> {
  const amount = opts.amount ?? 500; // $5.00
  const currency = opts.currency ?? 'usd';
  const timestamp = new Date().toISOString();

  const body = new URLSearchParams({
    amount: String(amount),
    currency,
    'payment_method_types[]': 'card',
    description: 'PaySwap live test — payment intent',
  });

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${STRIPE_API}/payment_intents`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }),
    );

    const json = (await resp.json()) as StripePaymentIntent & { error?: { message: string; type: string } };

    if (!resp.ok || json.error) {
      return {
        provider: 'Stripe', operation: 'createPaymentIntent', success: false,
        status: resp.status, latencyMs, environment: 'test',
        timestamp, summary: `Stripe API error: ${json.error?.message ?? resp.statusText}`,
        error: json.error?.message ?? `HTTP ${resp.status}`,
        requestPreview: { amount, currency, key: redactKey(requireEnv('STRIPE_SECRET_KEY')) },
      };
    }

    return {
      provider: 'Stripe', operation: 'createPaymentIntent', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json,
      summary: `Created PaymentIntent ${json.id} for ${(json.amount / 100).toFixed(2)} ${json.currency.toUpperCase()} (status: ${json.status}).`,
      requestPreview: { amount, currency, endpoint: '/v1/payment_intents', key: redactKey(requireEnv('STRIPE_SECRET_KEY')) },
      rawResponse: { id: json.id, amount: json.amount, currency: json.currency, status: json.status, created: json.created },
    };
  } catch (e) {
    return {
      provider: 'Stripe', operation: 'createPaymentIntent', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Retrieve a Payment Intent to verify it exists. */
export async function retrievePaymentIntent(intentId: string): Promise<LiveTestResult<StripePaymentIntent>> {
  const timestamp = new Date().toISOString();
  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${STRIPE_API}/payment_intents/${intentId}`, {
        headers: { Authorization: authHeader() },
      }),
    );
    const json = (await resp.json()) as StripePaymentIntent & { error?: { message: string } };
    if (!resp.ok || json.error) {
      return {
        provider: 'Stripe', operation: 'retrievePaymentIntent', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Retrieve failed: ${json.error?.message ?? resp.statusText}`,
        error: json.error?.message ?? `HTTP ${resp.status}`,
      };
    }
    return {
      provider: 'Stripe', operation: 'retrievePaymentIntent', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json,
      summary: `Retrieved PaymentIntent ${json.id} — status: ${json.status}.`,
      rawResponse: { id: json.id, status: json.status, amount: json.amount },
    };
  } catch (e) {
    return {
      provider: 'Stripe', operation: 'retrievePaymentIntent', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Create a test customer. */
export async function createCustomer(opts: { email?: string; name?: string } = {}): Promise<LiveTestResult<StripeCustomer>> {
  const email = opts.email ?? `payswap-test-${Date.now()}@example.com`;
  const name = opts.name ?? 'PaySwap Test Customer';
  const timestamp = new Date().toISOString();
  const body = new URLSearchParams({ email, name, description: 'PaySwap live test customer' });

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${STRIPE_API}/customers`, {
        method: 'POST',
        headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
    );
    const json = (await resp.json()) as StripeCustomer & { error?: { message: string } };
    if (!resp.ok || json.error) {
      return {
        provider: 'Stripe', operation: 'createCustomer', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Customer creation failed: ${json.error?.message ?? resp.statusText}`,
        error: json.error?.message ?? `HTTP ${resp.status}`,
      };
    }
    return {
      provider: 'Stripe', operation: 'createCustomer', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json,
      summary: `Created customer ${json.id} (${json.email}).`,
      requestPreview: { email, name },
      rawResponse: { id: json.id, email: json.email, name: json.name, created: json.created },
    };
  } catch (e) {
    return {
      provider: 'Stripe', operation: 'createCustomer', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Run the full Stripe test suite: create customer → create payment intent → retrieve it. */
export async function runStripeTest(): Promise<{
  customer: LiveTestResult<StripeCustomer>;
  paymentIntent: LiveTestResult<StripePaymentIntent>;
  retrieval: LiveTestResult<StripePaymentIntent>;
}> {
  const customer = await createCustomer();
  const paymentIntent = await createPaymentIntent({ amount: 1500, currency: 'usd' });
  const retrieval = paymentIntent.success && paymentIntent.data
    ? await retrievePaymentIntent(paymentIntent.data.id)
    : paymentIntent;
  return { customer, paymentIntent, retrieval };
}
