/**
 * PaySwap Protocol — Production Connectors v2 — FX Rate Connector.
 *
 * Real-shape simulated FX rate connector. Operations:
 *   - getRate({ fromCurrency, toCurrency })                  → rate, timestamp
 *   - getHistoricalRate({ fromCurrency, toCurrency, date })   → rate, date
 *   - convert({ amount, fromCurrency, toCurrency })            → convertedAmount, rate
 *
 * Auth: API key header (`X-API-KEY: <key>`). Real providers: Open Exchange Rates,
 * Fixer.io, ECB. We seed a base rate table and apply a deterministic daily drift
 * so successive calls within a day return the same rate (idempotent-friendly),
 * but cross-day calls return slightly different rates.
 *
 * Evidence: source='third_party_attestation', verificationLevel='attested',
 *           reputation=0.8, TTL 30s (FX rates expire fast).
 */
import type { Evidence } from '@/kernel/evidence';
import type {
  ConnectorConfig,
  ConnectorError,
  ConnectorRequest,
} from './types';
import { ProductionConnector, buildAttestationEvidence } from './base';
import { invalidResponse } from './errors';
import { deterministicHash } from './open-banking';

const DEFAULT_CONFIG: ConnectorConfig = {
  id: 'fx_rate',
  type: 'exchange',
  name: 'FX Rate Provider',
  endpoint: 'https://api.exchangerates.example.com/v1',
  apiKeyRef: 'vault://payswap/fx-rate/prod/api-key',
  secretRef: 'vault://payswap/fx-rate/prod/hmac-secret',
  timeout: 3_000,
  retryCount: 2,
  retryBackoffMs: 200,
  rateLimitRps: 30,
  rateLimitBurst: 60,
  // FX rates expire fast — short idempotency window.
  idempotencyTtlMs: 30_000,
};

// Base USD-denominated rates (real-world ECB-style snapshot).
const BASE_USD_RATES: Record<string, number> = {
  USD: 1.0,
  KES: 129.4,
  GHS: 12.1,
  NGN: 1560.0,
  ZAR: 18.6,
  UGX: 3780.0,
  TZS: 2520.0,
  EUR: 0.92,
  GBP: 0.79,
};

export class FxRateConnector extends ProductionConnector {
  constructor(config?: Partial<ConnectorConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  protected authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-KEY': this.apiKey || '<unresolved>',
    };
  }

  async doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // In production:
    //   const res = await fetch(`${this.config.endpoint}/latest?base=${from}&symbols=${to}`, {
    //     headers: this.authHeaders(),
    //   });
    //   const body = await res.json();
    //   if (!res.ok) return { result: {}, error: fromHttpError(res.status, body) };
    //   return { result: body };
    switch (request.operation) {
      case 'getRate':
        return this.simGetRate(request);
      case 'getHistoricalRate':
        return this.simGetHistoricalRate(request);
      case 'convert':
        return this.simConvert(request);
      default:
        return { result: {}, error: invalidResponse(`Unknown operation: ${request.operation}`) };
    }
  }

  /** Compute a deterministic rate for a pair. Crosses through USD if no direct rate. */
  private computeRate(from: string, to: string, dateStable?: string): number {
    const fromRate = BASE_USD_RATES[from] ?? 1.0;
    const toRate = BASE_USD_RATES[to] ?? 1.0;
    let rate = toRate / fromRate;
    // Deterministic per-day drift: ±0.5% based on date hash.
    if (dateStable) {
      const h = deterministicHash(`${from}${to}${dateStable}`);
      const drift = (parseInt(h.slice(0, 4), 16) % 1000) / 1000 - 0.5; // -0.5..+0.5
      rate = rate * (1 + drift * 0.01); // ±0.5%
    }
    return Math.round(rate * 1_000_000) / 1_000_000;
  }

  private simGetRate(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { fromCurrency, toCurrency } = request.params as { fromCurrency?: string; toCurrency?: string };
    if (!fromCurrency || !toCurrency) {
      return { result: {}, error: invalidResponse('fromCurrency and toCurrency required') };
    }
    const today = new Date().toISOString().slice(0, 10);
    const rate = this.computeRate(fromCurrency, toCurrency, today);
    return {
      result: {
        base: fromCurrency,
        date: today,
        rates: { [toCurrency]: rate },
        rate,
        timestamp: Date.now(),
      },
    };
  }

  private simGetHistoricalRate(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { fromCurrency, toCurrency, date } = request.params as { fromCurrency?: string; toCurrency?: string; date?: string };
    if (!fromCurrency || !toCurrency || !date) {
      return { result: {}, error: invalidResponse('fromCurrency, toCurrency, date required') };
    }
    const rate = this.computeRate(fromCurrency, toCurrency, date);
    return {
      result: {
        base: fromCurrency,
        date,
        rates: { [toCurrency]: rate },
        rate,
        timestamp: Date.parse(date) || Date.now(),
      },
    };
  }

  private simConvert(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { amount, fromCurrency, toCurrency } = request.params as {
      amount?: number; fromCurrency?: string; toCurrency?: string;
    };
    if (amount == null || !fromCurrency || !toCurrency) {
      return { result: {}, error: invalidResponse('amount, fromCurrency, toCurrency required') };
    }
    const today = new Date().toISOString().slice(0, 10);
    const rate = this.computeRate(fromCurrency, toCurrency, today);
    const convertedAmount = Math.round(amount * rate * 100) / 100;
    return {
      result: {
        amount,
        fromCurrency,
        toCurrency,
        rate,
        convertedAmount,
        date: today,
        timestamp: Date.now(),
      },
    };
  }

  buildEvidence(request: ConnectorRequest, result: Record<string, unknown>): Evidence {
    const fromCurrency = (request.params.fromCurrency as string | undefined) ?? (result.base as string | undefined) ?? 'USD';
    const toCurrency =
      (request.params.toCurrency as string | undefined) ??
      (typeof result.rates === 'object' && result.rates ? Object.keys(result.rates as Record<string, unknown>)[0] : 'USD');
    const rate = (result.rate as number | undefined) ?? 1.0;
    const convertedAmount = result.convertedAmount as number | undefined;

    const entityId = `fx:${fromCurrency}-${toCurrency}`;
    const attestedValue = convertedAmount != null
      ? `${convertedAmount} ${toCurrency} (rate ${rate} ${fromCurrency}→${toCurrency})`
      : `1 ${fromCurrency} = ${rate} ${toCurrency}`;

    return buildAttestationEvidence({
      source: 'third_party_attestation',
      verificationLevel: 'attested',
      entityId,
      attester: this.config.id,
      attestedAmount: convertedAmount ?? rate,
      currency: toCurrency,
      reputation: 0.8,
      ttlMs: 30_000, // FX rates expire fast
      payload: {
        connector: this.config.id,
        connectorType: this.config.type,
        operation: request.operation,
        attestedValue,
        fromCurrency,
        toCurrency,
        rate,
        convertedAmount,
        rateTimestamp: result.timestamp,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Math.floor(Math.random() * 100) + 50 };
  }
}
