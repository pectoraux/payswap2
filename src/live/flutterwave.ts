/**
 * Flutterwave live connector — real REST API calls to Flutterwave's test mode.
 *
 * Operations:
 *   - initiatePayment: POST /v3/payments
 *   - verifyPayment: GET /v3/transactions/:id/verify
 *   - getBanks: GET /banks/NG  (or /banks/GH)
 *
 * Auth: Bearer FLWSECK_TEST-...
 * Docs: https://developer.flutterwave.com/reference-endpoints
 */

import { requireEnv, redactKey, timed, type LiveTestResult } from './types';

const FLW_API = 'https://api.flutterwave.com/v3';

interface FlwPaymentResponse {
  status: string; // 'success'
  message: string;
  data: {
    link: string;
    id?: number;
    tx_ref?: string;
  };
}

interface FlwVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
    customer: { email: string; name: string };
    created_at: string;
  };
}

interface FlwBanksResponse {
  status: string;
  message: string;
  data: Array<{ id: number; code: string; name: string }>;
}

function authHeader(): string {
  return `Bearer ${requireEnv('FLW_SECRET_KEY')}`;
}

/** Initiate a payment (creates a payment link). */
export async function initiatePayment(opts: {
  amount?: number;
  currency?: string; // GHS, KES, NGN, USD
  email?: string;
} = {}): Promise<LiveTestResult<FlwPaymentResponse['data']>> {
  const amount = opts.amount ?? 50;
  const currency = opts.currency ?? 'GHS';
  const email = opts.email ?? `payswap-test-${Date.now()}@example.com`;
  const txRef = `flw_${Date.now()}`;
  const timestamp = new Date().toISOString();

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${FLW_API}/payments`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: txRef,
          amount,
          currency,
          redirect_url: 'https://payswap.org/callback',
          customer: { email, name: 'PaySwap Test' },
          customizations: { title: 'PaySwap Live Test', description: 'Cross-border payment test' },
          payment_options: 'card, mobilemoneyghana',
        }),
      }),
    );
    const json = (await resp.json()) as FlwPaymentResponse & { error?: string };

    if (!resp.ok || json.status !== 'success') {
      return {
        provider: 'Flutterwave', operation: 'initiatePayment', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Flutterwave error: ${json.message ?? resp.statusText}`,
        error: json.message ?? `HTTP ${resp.status}`,
        requestPreview: { amount, currency, tx_ref: txRef, email, key: redactKey(requireEnv('FLW_SECRET_KEY')) },
      };
    }

    return {
      provider: 'Flutterwave', operation: 'initiatePayment', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json.data,
      summary: `Initiated payment ${json.data.tx_ref ?? txRef} for ${amount} ${currency}${json.data.id ? ` (id: ${json.data.id})` : ''}.`,
      requestPreview: { amount, currency, tx_ref: txRef, endpoint: '/v3/payments' },
      rawResponse: { id: json.data.id, tx_ref: json.data.tx_ref, link: json.data.link.slice(0, 60) + '…' },
    };
  } catch (e) {
    return {
      provider: 'Flutterwave', operation: 'initiatePayment', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Verify a payment by transaction ID. */
export async function verifyPayment(txId: number): Promise<LiveTestResult<FlwVerifyResponse['data']>> {
  const timestamp = new Date().toISOString();
  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${FLW_API}/transactions/${txId}/verify`, {
        headers: { Authorization: authHeader() },
      }),
    );
    const json = (await resp.json()) as FlwVerifyResponse & { error?: string };
    if (!resp.ok || json.status !== 'success') {
      return {
        provider: 'Flutterwave', operation: 'verifyPayment', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Verify failed: ${json.message ?? resp.statusText}`,
        error: json.message ?? `HTTP ${resp.status}`,
      };
    }
    return {
      provider: 'Flutterwave', operation: 'verifyPayment', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json.data,
      summary: `Verified transaction ${json.data.tx_ref} — status: ${json.data.status}, ${json.data.amount} ${json.data.currency}.`,
      rawResponse: { id: json.data.id, tx_ref: json.data.tx_ref, status: json.data.status, amount: json.data.amount, currency: json.data.currency },
    };
  } catch (e) {
    return {
      provider: 'Flutterwave', operation: 'verifyPayment', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** List banks for a country code — validates API access. */
export async function getBanks(country = 'GH'): Promise<LiveTestResult<FlwBanksResponse['data']>> {
  const timestamp = new Date().toISOString();
  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${FLW_API}/banks/${country}`, {
        headers: { Authorization: authHeader() },
      }),
    );
    const json = (await resp.json()) as FlwBanksResponse & { error?: string };
    if (!resp.ok || json.status !== 'success') {
      return {
        provider: 'Flutterwave', operation: 'getBanks', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Get banks failed: ${json.message ?? resp.statusText}`,
        error: json.message ?? `HTTP ${resp.status}`,
      };
    }
    const top5 = json.data.slice(0, 5);
    return {
      provider: 'Flutterwave', operation: 'getBanks', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: top5,
      summary: `Listed ${json.data.length} banks in ${country} (showing top 5).`,
      rawResponse: { count: json.data.length, banks: top5.map((b) => ({ name: b.name, code: b.code })) },
    };
  } catch (e) {
    return {
      provider: 'Flutterwave', operation: 'getBanks', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Run the full Flutterwave test suite. */
export async function runFlutterwaveTest(): Promise<{
  banks: LiveTestResult<FlwBanksResponse['data']>;
  payment: LiveTestResult<FlwPaymentResponse['data']>;
  verify: LiveTestResult<FlwVerifyResponse['data']>;
}> {
  const banks = await getBanks('GH');
  const payment = await initiatePayment({ amount: 75, currency: 'GHS' });
  const verify = payment.success && payment.data?.id
    ? await verifyPayment(payment.data.id)
    : { ...payment, operation: 'verifyPayment' as const, summary: 'Skipped — no transaction id returned (test mode).' };
  return { banks, payment, verify };
}
