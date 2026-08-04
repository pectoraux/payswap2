/**
 * Paystack live connector — real REST API calls to Paystack's test mode.
 *
 * Operations:
 *   - initializeTransaction: POST /transaction/initialize
 *   - verifyTransaction: GET /transaction/verify/:reference
 *   - listBanks: GET /bank?country=ghana
 *
 * Auth: Bearer sk_test_...
 * Docs: https://paystack.com/docs/api/
 */

import { requireEnv, redactKey, timed, type LiveTestResult } from './types';

const PAYSTACK_API = 'https://api.paystack.co';

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    reference: string;
    amount: number; // in kobo (GHS pesewa)
    currency: string;
    status: string;
    customer: { email: string };
    created_at: string;
  };
}

interface PaystackBankList {
  status: boolean;
  data: Array<{ id: number; name: string; slug: string; code: string; country: string }>;
}

function authHeader(): string {
  return `Bearer ${requireEnv('PAYSTACK_SECRET_KEY')}`;
}

/** Initialize a transaction (creates a payment link for test mode). */
export async function initializeTransaction(opts: {
  email?: string;
  amount?: number; // in pesewa (1 GHS = 100 pesewa)
  currency?: string;
} = {}): Promise<LiveTestResult<PaystackInitResponse['data']>> {
  const email = opts.email ?? `payswap-test-${Date.now()}@example.com`;
  const amount = opts.amount ?? 5000; // 50.00 GHS
  const currency = opts.currency ?? 'GHS';
  const timestamp = new Date().toISOString();
  const reference = `ps_${Date.now()}`;

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${PAYSTACK_API}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, amount, currency, reference }),
      }),
    );
    const json = (await resp.json()) as PaystackInitResponse & { error?: string };

    if (!resp.ok || !json.status) {
      return {
        provider: 'Paystack', operation: 'initializeTransaction', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Paystack error: ${json.message ?? resp.statusText}`,
        error: json.message ?? json.error ?? `HTTP ${resp.status}`,
        requestPreview: { email, amount, currency, reference, key: redactKey(requireEnv('PAYSTACK_SECRET_KEY')) },
      };
    }

    return {
      provider: 'Paystack', operation: 'initializeTransaction', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json.data,
      summary: `Initialized transaction ${json.data.reference} for ${(amount / 100).toFixed(2)} ${currency}.`,
      requestPreview: { email, amount, currency, reference, endpoint: '/transaction/initialize' },
      rawResponse: { reference: json.data.reference, access_code: json.data.access_code, authorization_url: json.data.authorization_url.slice(0, 60) + '…' },
    };
  } catch (e) {
    return {
      provider: 'Paystack', operation: 'initializeTransaction', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Verify a transaction by reference. */
export async function verifyTransaction(reference: string): Promise<LiveTestResult<PaystackVerifyResponse['data']>> {
  const timestamp = new Date().toISOString();
  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${PAYSTACK_API}/transaction/verify/${reference}`, {
        headers: { Authorization: authHeader() },
      }),
    );
    const json = (await resp.json()) as PaystackVerifyResponse & { error?: string };
    if (!resp.ok || !json.status) {
      return {
        provider: 'Paystack', operation: 'verifyTransaction', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `Verify failed: ${json.message ?? resp.statusText}`,
        error: json.message ?? `HTTP ${resp.status}`,
      };
    }
    return {
      provider: 'Paystack', operation: 'verifyTransaction', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json.data,
      summary: `Verified transaction ${json.data.reference} — status: ${json.data.status}, amount: ${(json.data.amount / 100).toFixed(2)} ${json.data.currency}.`,
      rawResponse: { id: json.data.id, reference: json.data.reference, status: json.data.status, amount: json.data.amount, currency: json.data.currency },
    };
  } catch (e) {
    return {
      provider: 'Paystack', operation: 'verifyTransaction', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** List supported banks for a country — validates API access without creating anything. */
export async function listBanks(country = 'ghana'): Promise<LiveTestResult<PaystackBankList['data']>> {
  const timestamp = new Date().toISOString();
  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${PAYSTACK_API}/bank?country=${country}&perPage=5`, {
        headers: { Authorization: authHeader() },
      }),
    );
    const json = (await resp.json()) as PaystackBankList & { error?: string };
    if (!resp.ok || !json.status) {
      return {
        provider: 'Paystack', operation: 'listBanks', success: false,
        status: resp.status, latencyMs, environment: 'test', timestamp,
        summary: `List banks failed: ${json.message ?? resp.statusText}`,
        error: json.message ?? `HTTP ${resp.status}`,
      };
    }
    return {
      provider: 'Paystack', operation: 'listBanks', success: true,
      status: 200, latencyMs, environment: 'test', timestamp,
      data: json.data,
      summary: `Listed ${json.data.length} banks in ${country} (showing top 5).`,
      rawResponse: { count: json.data.length, banks: json.data.map((b) => ({ name: b.name, code: b.code })) },
    };
  } catch (e) {
    return {
      provider: 'Paystack', operation: 'listBanks', success: false,
      status: 0, latencyMs: 0, environment: 'test', timestamp,
      summary: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Run the full Paystack test suite. */
export async function runPaystackTest(): Promise<{
  banks: LiveTestResult<PaystackBankList['data']>;
  init: LiveTestResult<PaystackInitResponse['data']>;
  verify: LiveTestResult<PaystackVerifyResponse['data']>;
}> {
  const banks = await listBanks('ghana');
  const init = await initializeTransaction({ amount: 10000, currency: 'GHS' }); // 100 GHS
  const verify = init.success && init.data ? await verifyTransaction(init.data.reference) : init as never;
  return { banks, init, verify };
}
