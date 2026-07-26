/**
 * PaySwap Protocol — Provider Adapter — Chainalysis KYT (Compliance).
 *
 * Simulated Chainalysis KYT (Know Your Transaction) API connector. Real
 * implementations call the Chainalysis KYT REST API
 * (api.chainalysis.com/api/kyt/v1) with an API key in the `Token`
 * header; this in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - screenAddress({ asset, address })                              — GET /api/kyt/v1/addresses/{asset}/{address}
 *   - screenTransaction({ asset, txHash })                           — GET /api/kyt/v1/transactions/{asset}/{txHash}
 *   - getAddressRisk({ asset, address })                             — synthesized risk score for an address
 *   - getTransactionRisk({ asset, txHash })                          — synthesized risk score for a transaction
 *
 * Auth: API key in the `Token` header (no OAuth2 — single static key).
 *
 * Simulated response shape:
 *   - Address screening returns a 0–100 risk score plus exposure
 *     breakdown by illicit-service category (sanctions, darknet_market,
 *     mixer, scam, stolen_funds, terrorist_financing, etc.).
 *   - Transaction screening returns the same breakdown plus transferred
 *     amount + counterparties.
 *
 * The compliance module (`src/protocol/compliance/aml.ts`) consumes the
 * risk score from this adapter to raise `AMLAlert`s for high-risk
 * counterparties.
 *
 * Evidence: source='third_party_attestation',
 * verificationLevel='attested', reputation=0.95, jurisdiction='US'.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import type { ConnectorRequest } from '@/protocol/connectors-v2/types';
import { authFailed, invalidResponse } from '@/protocol/connectors-v2/errors';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { ProductionConnector, type DoQueryResult } from '@/protocol/connectors-v2/base';
import { asConnectorConfig, type ProviderConfig } from './types';

/** Default config — Chainalysis KYT API characteristics. */
export const DEFAULT_CHAINALYSIS_CONFIG: ProviderConfig = {
  id: 'chainalysis',
  type: 'compliance',
  name: 'Chainalysis KYT',
  endpoint: 'https://api.chainalysis.com/api/kyt/v1',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 250,
  rateLimitRps: 25,
  rateLimitBurst: 50,
  idempotencyTtlMs: 60 * 60 * 1000, // KYT results are stable; cache 1h
  environment: 'production',
};

/** Chainalysis KYT exposure categories. */
export type ChainalysisExposureCategory =
  | 'sanctions'
  | 'darknet_market'
  | 'mixer'
  | 'scam'
  | 'stolen_funds'
  | 'terrorist_financing'
  | 'fraud_shop'
  | 'high_risk_exchange'
  | 'illegal_service'
  | 'atm';

export interface ChainalysisExposure {
  category: ChainalysisExposureCategory;
  /** Volume exposed to this category, in the asset's smallest unit. */
  amount: string;
  /** USD-equivalent at screening time. */
  usd: number;
}

export interface ChainalysisAddressScreening {
  asset: string;
  address: string;
  riskScore: number;          // 0..100
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  clusterName?: string;
  clusterCategory?: string;
  exposures: ChainalysisExposure[];
  screenedAt: number;
}

export interface ChainalysisTxScreening {
  asset: string;
  txHash: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  transferredAmount: string;
  transferredUsd: number;
  outputs: Array<{ address: string; riskScore: number; exposures: ChainalysisExposure[] }>;
  inputs: Array<{ address: string; riskScore: number; exposures: ChainalysisExposure[] }>;
  screenedAt: number;
}

/** Deterministic pseudo-risk from a string (so the same address is stable). */
function pseudoRisk(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 101; // 0..100
}

function riskLevelFromScore(score: number): ChainalysisAddressScreening['riskLevel'] {
  if (score >= 80) return 'severe';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

/** Synthesise exposures for an address based on its risk score. */
function synthesiseExposures(seed: string, score: number, asset: string): ChainalysisExposure[] {
  if (score < 10) return []; // clean address
  const categories: ChainalysisExposureCategory[] = [
    'sanctions', 'darknet_market', 'mixer', 'scam', 'stolen_funds',
    'terrorist_financing', 'fraud_shop', 'high_risk_exchange', 'illegal_service', 'atm',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const positive = Math.abs(h);
  const count = Math.min(categories.length, Math.floor(score / 10));
  const out: ChainalysisExposure[] = [];
  for (let i = 0; i < count; i++) {
    const category = categories[(positive + i * 7) % categories.length];
    const usd = round((positive % 1000) * (i + 1) * (score / 100), 2);
    out.push({
      category,
      amount: String(Math.floor(usd * 100)), // smallest unit
      usd,
    });
  }
  // Stable asset tag (suppressed from linter; only used for cache keying).
  void asset;
  return out;
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

export class ChainalysisConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly addressCache = new Map<string, ChainalysisAddressScreening>();
  private readonly txCache = new Map<string, ChainalysisTxScreening>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_CHAINALYSIS_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'screenAddress':
        return this.screenAddress(request.params);
      case 'screenTransaction':
        return this.screenTransaction(request.params);
      case 'getAddressRisk':
        return this.getAddressRisk(request.params);
      case 'getTransactionRisk':
        return this.getTransactionRisk(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['address'] as string | undefined) ??
      (params['txHash'] as string | undefined) ??
      request.id;
    return createEvidence({
      type: 'attestation',
      source: 'third_party_attestation',
      verificationLevel: 'attested',
      entityId,
      attester: 'chainalysis-kyt-connector',
      reputation: 0.95,
      jurisdiction: 'US',
      payload: { operation: request.operation, requestId: request.id, provider: 'chainalysis', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /** Chainalysis KYT uses a single API key in the `Token` header. */
  private authenticate(): { ok: true } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKey } = this.providerConfig;
    if (!apiKey) {
      return { ok: false, error: authFailed('chainalysis: api_key required') };
    }
    return { ok: true };
  }

  // ------------------------------------------------------------- screenAddress
  private screenAddress(params: Record<string, unknown>): DoQueryResult {
    const asset = (params['asset'] as string | undefined)?.toLowerCase();
    const address = params['address'] as string | undefined;
    if (!asset || !address) {
      return { ok: false, error: invalidResponse('asset_address_required') };
    }
    const cacheKey = `${asset}:${address}`;
    let result = this.addressCache.get(cacheKey);
    if (!result) {
      const score = pseudoRisk(cacheKey);
      result = {
        asset,
        address,
        riskScore: score,
        riskLevel: riskLevelFromScore(score),
        clusterName: score > 30 ? `cluster-${uid('cl').slice(-6)}` : undefined,
        clusterCategory: score > 50 ? 'high_risk_exchange' : undefined,
        exposures: synthesiseExposures(cacheKey, score, asset),
        screenedAt: Date.now(),
      };
      this.addressCache.set(cacheKey, result);
    }
    return { ok: true, data: result };
  }

  // ---------------------------------------------------------- screenTransaction
  private screenTransaction(params: Record<string, unknown>): DoQueryResult {
    const asset = (params['asset'] as string | undefined)?.toLowerCase();
    const txHash = params['txHash'] as string | undefined;
    if (!asset || !txHash) {
      return { ok: false, error: invalidResponse('asset_txHash_required') };
    }
    const cacheKey = `${asset}:${txHash}`;
    let result = this.txCache.get(cacheKey);
    if (!result) {
      const score = pseudoRisk(cacheKey);
      const transferredUsd = round((Math.abs(pseudoRisk(cacheKey + 'amt')) * 100), 2);
      result = {
        asset,
        txHash,
        riskScore: score,
        riskLevel: riskLevelFromScore(score),
        transferredAmount: String(Math.floor(transferredUsd * 100)),
        transferredUsd,
        outputs: [
          {
            address: '0x' + '0'.repeat(38) + uid('out').slice(-2),
            riskScore: Math.max(0, score - 10),
            exposures: synthesiseExposures(cacheKey + 'out', Math.max(0, score - 10), asset),
          },
        ],
        inputs: [
          {
            address: '0x' + '0'.repeat(38) + uid('in').slice(-2),
            riskScore: Math.min(100, score + 5),
            exposures: synthesiseExposures(cacheKey + 'in', Math.min(100, score + 5), asset),
          },
        ],
        screenedAt: Date.now(),
      };
      this.txCache.set(cacheKey, result);
    }
    return { ok: true, data: result };
  }

  // ----------------------------------------------------------- getAddressRisk
  private getAddressRisk(params: Record<string, unknown>): DoQueryResult {
    const inner = this.screenAddress(params);
    if (!inner.ok) return inner;
    const screening = inner.data as ChainalysisAddressScreening;
    return {
      ok: true,
      data: {
        asset: screening.asset,
        address: screening.address,
        riskScore: screening.riskScore,
        riskLevel: screening.riskLevel,
        recommendation:
          screening.riskLevel === 'severe' ? 'block'
          : screening.riskLevel === 'high' ? 'review'
          : screening.riskLevel === 'medium' ? 'monitor'
          : 'allow',
        exposures: screening.exposures,
        screenedAt: screening.screenedAt,
      },
    };
  }

  // -------------------------------------------------------- getTransactionRisk
  private getTransactionRisk(params: Record<string, unknown>): DoQueryResult {
    const inner = this.screenTransaction(params);
    if (!inner.ok) return inner;
    const screening = inner.data as ChainalysisTxScreening;
    return {
      ok: true,
      data: {
        asset: screening.asset,
        txHash: screening.txHash,
        riskScore: screening.riskScore,
        riskLevel: screening.riskLevel,
        recommendation:
          screening.riskLevel === 'severe' ? 'block'
          : screening.riskLevel === 'high' ? 'review'
          : screening.riskLevel === 'medium' ? 'monitor'
          : 'allow',
        transferredUsd: screening.transferredUsd,
        counterpartyRisk: screening.outputs.map((o) => ({ address: o.address, riskScore: o.riskScore })),
        screenedAt: screening.screenedAt,
      },
    };
  }
}
