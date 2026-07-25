/**
 * PaySwap Protocol — Production Connectors v2 — FX Rate Feed.
 *
 * Simulated FX rate connector. Real implementations call a rate provider
 * (e.g. Open Exchange Rates, Fixer, ECB) and cache the result; this
 * in-process simulation uses a small table of indicative rates.
 *
 * Operations:
 *   - getRate({ fromCurrency, toCurrency })
 *   - convert({ amount, fromCurrency, toCurrency })
 *
 * Default indicative rates:
 *   GHS->KES = 10.75    KES->GHS = 0.093
 *   USD->GHS = 12.1     GHS->USD = 0.083
 *
 * Evidence: source='third_party_attestation', verificationLevel='attested',
 * reputation=0.8, TTL=30s (FX rates decay fast).
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { round } from '@/kernel/support';
import type { ConnectorConfig, ConnectorRequest } from './types';
import { invalidResponse } from './errors';
import { HealthMonitor } from './health';
import { MetricsCollector } from './metrics';
import { IdempotencyStore } from './idempotency';
import { ProductionConnector, type DoQueryResult } from './base';

/** Default config — FX feeds tolerate high RPS but data is short-lived. */
export const DEFAULT_FX_RATE_CONFIG: ConnectorConfig = {
  id: 'fx_rate',
  type: 'fx_rate',
  name: 'FX Rate Feed',
  endpoint: 'sim://fx/v1',
  timeout: 3_000,
  retryCount: 2,
  retryBackoffMs: 200,
  rateLimitRps: 30,
  rateLimitBurst: 60,
  idempotencyTtlMs: 30_000, // matches evidence TTL — rates go stale in 30s
};

/** Direct quote table. Pairs not in the table are derived via USD if possible. */
const RATES: Record<string, number> = {
  'GHS->KES': 10.75,
  'KES->GHS': 0.093,
  'USD->GHS': 12.1,
  'GHS->USD': 0.083,
};

/** TTL for FX evidence — 30 seconds. Rates decay fast. */
const FX_EVIDENCE_TTL_MS = 30_000;

function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export class FxRateConnector extends ProductionConnector {
  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ConnectorConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(
      { ...DEFAULT_FX_RATE_CONFIG, ...config },
      healthMonitor,
      metricsCollector,
      idempotency,
    );
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getRate':
        return this.getRate(request.params);
      case 'convert':
        return this.convert(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const fromCurrency = (params['fromCurrency'] as string | undefined) ?? 'UNKNOWN';
    const toCurrency = (params['toCurrency'] as string | undefined) ?? 'UNKNOWN';
    const entityId = `fx:${pairKey(fromCurrency, toCurrency)}`;
    return createEvidence({
      type: 'attestation',
      source: 'third_party_attestation',
      verificationLevel: 'attested',
      entityId,
      attester: 'fx-rate-connector-v2',
      reputation: 0.8,
      ttlMs: FX_EVIDENCE_TTL_MS,
      currency: toCurrency,
      payload: { operation: request.operation, requestId: request.id, fromCurrency, toCurrency, result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // ------------------------------------------------------------------- getRate
  private getRate(params: Record<string, unknown>): DoQueryResult {
    const fromCurrency = params['fromCurrency'] as string | undefined;
    const toCurrency = params['toCurrency'] as string | undefined;
    if (!fromCurrency || !toCurrency) {
      return { ok: false, error: invalidResponse('fromCurrency_toCurrency_required') };
    }
    if (fromCurrency === toCurrency) {
      return {
        ok: true,
        data: { fromCurrency, toCurrency, rate: 1, asOf: Date.now(), source: 'identity' },
      };
    }
    const rate = this.lookupRate(fromCurrency, toCurrency);
    if (rate === null) {
      return {
        ok: false,
        error: invalidResponse(`rate_not_available:${pairKey(fromCurrency, toCurrency)}`),
      };
    }
    return {
      ok: true,
      data: { fromCurrency, toCurrency, rate: round(rate, 6), asOf: Date.now(), source: 'indicative' },
    };
  }

  // -------------------------------------------------------------------- convert
  private convert(params: Record<string, unknown>): DoQueryResult {
    const amount = params['amount'] as number | undefined;
    const fromCurrency = params['fromCurrency'] as string | undefined;
    const toCurrency = params['toCurrency'] as string | undefined;
    if (amount === undefined || !fromCurrency || !toCurrency) {
      return { ok: false, error: invalidResponse('amount_fromCurrency_toCurrency_required') };
    }
    if (fromCurrency === toCurrency) {
      return {
        ok: true,
        data: {
          fromCurrency,
          toCurrency,
          rate: 1,
          inputAmount: round(amount, 2),
          outputAmount: round(amount, 2),
          asOf: Date.now(),
        },
      };
    }
    const rate = this.lookupRate(fromCurrency, toCurrency);
    if (rate === null) {
      return {
        ok: false,
        error: invalidResponse(`rate_not_available:${pairKey(fromCurrency, toCurrency)}`),
      };
    }
    return {
      ok: true,
      data: {
        fromCurrency,
        toCurrency,
        rate: round(rate, 6),
        inputAmount: round(amount, 2),
        outputAmount: round(amount * rate, 2),
        asOf: Date.now(),
      },
    };
  }

  /** Look up a rate directly, or try to synthesise via USD. */
  private lookupRate(from: string, to: string): number | null {
    const direct = RATES[pairKey(from, to)];
    if (direct !== undefined) return direct;

    // Synthesize via USD if both legs have a USD pair.
    if (from !== 'USD' && to !== 'USD') {
      const fromToUsd = RATES[pairKey(from, 'USD')];
      const usdToTo = RATES[pairKey('USD', to)];
      if (fromToUsd !== undefined && usdToTo !== undefined) {
        return fromToUsd * usdToTo;
      }
    }
    return null;
  }
}
