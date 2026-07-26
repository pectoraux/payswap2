/**
 * PaySwap Protocol — Provider Adapter — Open Banking / PSD2 (Berlin Group).
 *
 * Simulated Open Banking connector following the Berlin Group NextGenPSD2
 * specification. Real implementations call a bank's ASPSP endpoint
 * (or an aggregator like TrueLayer, Tink, Plaid) under OAuth2 with
 * refresh-token + client-credentials grant; this in-process simulation
 * mirrors that surface area so the protocol layer can run end-to-end.
 *
 * Operations:
 *   - getAccounts({})                                          — GET /v1/accounts
 *   - getAccountBalance({ accountId })                         — GET /v1/accounts/{accountId}/balances
 *   - initiatePayment({ creditorIban, debtorIban, amount, currency, remittance }) — POST /v1/payments/sepa-credit-transfers
 *   - getPaymentStatus({ paymentId })                          — GET /v1/payments/sepa-credit-transfers/{paymentId}/status
 *   - getTransactions({ accountId, from?, to?, limit? })       — GET /v1/accounts/{accountId}/transactions
 *
 * Auth: OAuth2 client-credentials + refresh token. The first
 * authenticated call mints an access token from `clientId:clientSecret`
 * (or refreshes using `refreshToken`). The token is reused until it
 * expires (~600s for PSD2 — much shorter than typical). Real impl
 * supports both grant types and rotates the refresh token on use.
 *
 * Evidence: source='open_banking', verificationLevel='institutional',
 * reputation=0.92, jurisdiction='EU'.
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
import {
  asConnectorConfig,
  isTokenExpired,
  type AuthResult,
  type AuthToken,
  type ProviderConfig,
} from './types';

/** Default config — Berlin Group NextGenPSD2 sandbox characteristics. */
export const DEFAULT_OPEN_BANKING_PSD2_CONFIG: ProviderConfig = {
  id: 'open_banking_psd2',
  type: 'bank',
  name: 'Open Banking (PSD2 Berlin Group)',
  endpoint: 'https://sim.open-banking.eu/v1',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 400,
  rateLimitRps: 8,
  rateLimitBurst: 16,
  idempotencyTtlMs: 5 * 60 * 1000,
  environment: 'sandbox',
};

interface Psd2Account {
  resourceId: string;
  iban: string;
  bban?: string;
  currency: string;
  name: string;
  product?: string;
  status: 'enabled' | 'deleted' | 'blocked';
  maskedPan?: string;
}

interface Psd2Balance {
  balanceAmount: { amount: number; currency: string };
  balanceType: 'closingBooked' | 'expected' | 'openingBooked' | 'interimAvailable' | 'interimBooked' | 'forwardAvailable';
  lastChangeDateTime: number;
  referenceDate: string;
}

interface Psd2Payment {
  paymentId: string;
  creditorName: string;
  creditorAccount: { iban: string };
  debtorAccount: { iban: string };
  instructedAmount: { amount: number; currency: string };
  remittanceInformationUnstructured?: string;
  transactionStatus: 'RCVD' | 'PDNG' | 'ACSC' | 'ACCC' | 'RJCT' | 'CANC' | 'ACSP' | 'ACTC';
  createdAt: number;
}

interface Psd2Transaction {
  transactionId: string;
  bookingDate: string;
  valueDate: string;
  transactionAmount: { amount: number; currency: string };
  remittanceInformationUnstructured?: string;
  creditorName?: string;
  debtorName?: string;
  creditorAccount?: { iban: string };
  debtorAccount?: { iban: string };
  proprietaryBank?: string;
}

/** Stable in-process account ledger seeded with a handful of test accounts. */
const SEED_ACCOUNTS: Psd2Account[] = [
  { resourceId: 'acct_001', iban: 'DE89370400440532013000', currency: 'EUR', name: 'Operating Account', product: 'CURRENT', status: 'enabled' },
  { resourceId: 'acct_002', iban: 'GB29NWBK60161331926819', currency: 'GBP', name: 'Reserve Account', product: 'CURRENT', status: 'enabled' },
  { resourceId: 'acct_003', iban: 'FR1420041010050500013M02606', currency: 'EUR', name: 'Settlement Account', product: 'CURRENT', status: 'enabled' },
];

function pseudoBalanceFor(iban: string): number {
  let h = 0;
  for (let i = 0; i < iban.length; i++) h = (h * 31 + iban.charCodeAt(i)) | 0;
  return round(10_000 + (Math.abs(h) % 990_000), 2);
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class OpenBankingPsd2Connector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private authToken: AuthToken | undefined;
  private readonly accounts = new Map<string, Psd2Account>();
  private readonly balances = new Map<string, Psd2Balance[]>();
  private readonly transactions = new Map<string, Psd2Transaction[]>();
  private readonly payments = new Map<string, Psd2Payment>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_OPEN_BANKING_PSD2_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
    // Seed the in-process ledger.
    for (const a of SEED_ACCOUNTS) {
      this.accounts.set(a.resourceId, a);
      this.balances.set(a.resourceId, [
        {
          balanceAmount: { amount: pseudoBalanceFor(a.iban), currency: a.currency },
          balanceType: 'closingBooked',
          lastChangeDateTime: Date.now(),
          referenceDate: isoDate(Date.now()),
        },
      ]);
      // Seed a couple of historical transactions per account.
      this.transactions.set(a.resourceId, [
        {
          transactionId: uid('psd2_tx'),
          bookingDate: isoDate(Date.now() - 7 * 24 * 60 * 60 * 1000),
          valueDate: isoDate(Date.now() - 7 * 24 * 60 * 60 * 1000),
          transactionAmount: { amount: round(1500 + Math.abs(pseudoBalanceFor(a.iban + 'seed1')) % 500, 2), currency: a.currency },
          remittanceInformationUnstructured: 'Monthly settlement',
          creditorName: 'PaySwap Treasury',
        },
        {
          transactionId: uid('psd2_tx'),
          bookingDate: isoDate(Date.now() - 3 * 24 * 60 * 60 * 1000),
          valueDate: isoDate(Date.now() - 3 * 24 * 60 * 60 * 1000),
          transactionAmount: { amount: round(-(200 + Math.abs(pseudoBalanceFor(a.iban + 'seed2')) % 200), 2), currency: a.currency },
          remittanceInformationUnstructured: 'LP payout',
          debtorName: 'PaySwap LP Pool',
        },
      ]);
    }
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'getAccounts':
        return this.getAccounts(request.params);
      case 'getAccountBalance':
        return this.getAccountBalance(request.params);
      case 'initiatePayment':
        return this.initiatePayment(request.params);
      case 'getPaymentStatus':
        return this.getPaymentStatus(request.params);
      case 'getTransactions':
        return this.getTransactions(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['accountId'] as string | undefined) ??
      (params['paymentId'] as string | undefined) ??
      (params['creditorIban'] as string | undefined) ??
      (params['debtorIban'] as string | undefined) ??
      request.id;
    const amount = params['amount'] as number | undefined;
    return createEvidence({
      type: 'fiat_proof',
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId,
      attester: 'open-banking-psd2-connector',
      reputation: 0.92,
      jurisdiction: 'EU',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof amount === 'number' ? round(amount, 2) : undefined,
      payload: { operation: request.operation, requestId: request.id, provider: 'open_banking_psd2', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /**
   * Simulated OAuth2 client-credentials + refresh-token flow.
   * Real impl POSTs to `/token` with grant_type=client_credentials
   * (or grant_type=refresh_token) and parses the access_token + expires_in.
   * PSD2 tokens are short-lived (~600s) and scoped to AIS/PIS.
   */
  private authenticate(): AuthResult {
    if (!isTokenExpired(this.authToken)) {
      return { ok: true, token: this.authToken! };
    }
    const { clientId, clientSecret, refreshToken } = this.providerConfig;
    if (!clientId || !clientSecret) {
      return { ok: false, error: authFailed('open_banking_psd2: clientId + clientSecret required') };
    }
    // If a refresh token is present, prefer the refresh grant (real impl
    // would also rotate the refresh token here).
    const grant = refreshToken ? 'refresh_token' : 'client_credentials';
    this.authToken = {
      accessToken: uid('psd2_tk'),
      tokenType: 'Bearer',
      expiresAt: Date.now() + 600 * 1000, // 10 min
      scope: `PIS:AIS ${grant}`,
    };
    return { ok: true, token: this.authToken };
  }

  // --------------------------------------------------------------- getAccounts
  private getAccounts(_params: Record<string, unknown>): DoQueryResult {
    const accounts = [...this.accounts.values()];
    return {
      ok: true,
      data: {
        accounts: accounts.map((a) => ({
          resourceId: a.resourceId,
          iban: a.iban,
          currency: a.currency,
          name: a.name,
          product: a.product,
          status: a.status,
        })),
        _links: { self: { href: '/v1/accounts' } },
      },
    };
  }

  // -------------------------------------------------------- getAccountBalance
  private getAccountBalance(params: Record<string, unknown>): DoQueryResult {
    const accountId = params['accountId'] as string | undefined;
    if (!accountId) {
      return { ok: false, error: invalidResponse('accountId_required') };
    }
    if (!this.accounts.has(accountId)) {
      return { ok: false, error: invalidResponse(`account_not_found:${accountId}`) };
    }
    return { ok: true, data: { account: { resourceId: accountId }, balances: this.balances.get(accountId)! } };
  }

  // ----------------------------------------------------------- initiatePayment
  private initiatePayment(params: Record<string, unknown>): DoQueryResult {
    const creditorIban = params['creditorIban'] as string | undefined;
    const debtorIban = params['debtorIban'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'EUR';
    const remittance = params['remittance'] as string | undefined;
    const creditorName = (params['creditorName'] as string | undefined) ?? 'Creditor';
    if (!creditorIban || !debtorIban || amount === undefined) {
      return { ok: false, error: invalidResponse('creditorIban_debtorIban_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const paymentId = uid('psd2_pay');
    const payment: Psd2Payment = {
      paymentId,
      creditorName,
      creditorAccount: { iban: creditorIban },
      debtorAccount: { iban: debtorIban },
      instructedAmount: { amount: round(amount, 2), currency },
      remittanceInformationUnstructured: remittance,
      transactionStatus: 'RCVD',
      createdAt: Date.now(),
    };
    this.payments.set(paymentId, payment);
    return {
      ok: true,
      data: {
        transactionStatus: payment.transactionStatus,
        paymentId,
        _links: {
          self: { href: `/v1/payments/sepa-credit-transfers/${paymentId}` },
          status: { href: `/v1/payments/sepa-credit-transfers/${paymentId}/status` },
        },
      },
    };
  }

  // ----------------------------------------------------------- getPaymentStatus
  private getPaymentStatus(params: Record<string, unknown>): DoQueryResult {
    const paymentId = params['paymentId'] as string | undefined;
    if (!paymentId) {
      return { ok: false, error: invalidResponse('paymentId_required') };
    }
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { ok: false, error: invalidResponse(`payment_not_found:${paymentId}`) };
    }
    // Simulate status progression: RCVD → PDNG → ACSC.
    const progression: Psd2Payment['transactionStatus'][] = ['RCVD', 'ACSP', 'ACTC', 'PDNG', 'ACSC'];
    const idx = progression.indexOf(payment.transactionStatus);
    if (idx >= 0 && idx < progression.length - 1) {
      payment.transactionStatus = progression[idx + 1];
    }
    return { ok: true, data: { transactionStatus: payment.transactionStatus, paymentId } };
  }

  // ------------------------------------------------------------- getTransactions
  private getTransactions(params: Record<string, unknown>): DoQueryResult {
    const accountId = params['accountId'] as string | undefined;
    const from = params['from'] as string | undefined;
    const to = params['to'] as string | undefined;
    const limit = (params['limit'] as number | undefined) ?? 100;
    if (!accountId) {
      return { ok: false, error: invalidResponse('accountId_required') };
    }
    if (!this.accounts.has(accountId)) {
      return { ok: false, error: invalidResponse(`account_not_found:${accountId}`) };
    }
    const all = this.transactions.get(accountId) ?? [];
    let filtered = all;
    if (from) filtered = filtered.filter((t) => t.bookingDate >= from);
    if (to) filtered = filtered.filter((t) => t.bookingDate <= to);
    return {
      ok: true,
      data: {
        account: { resourceId: accountId },
        transactions: {
          booked: filtered.slice(0, limit),
          pending: [],
          _links: { self: { href: `/v1/accounts/${accountId}/transactions` } },
        },
      },
    };
  }
}
