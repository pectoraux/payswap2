/**
 * PaySwap Protocol — Provider Adapter — TRM Labs (Crypto Compliance).
 *
 * Simulated TRM Labs API connector. Real implementations call the TRM
 * Labs REST API (api.trmlabs.com/v1) with an API key + HMAC-SHA256
 * request signing; this in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - screenAddress({ chain, address })                  — POST /v1/address screen
 *   - getAddressRiskIndicators({ chain, address })       — synthesized indicators
 *   - getTransactionRisk({ chain, txHash })              — synthesized tx risk
 *
 * Auth: API key in the header + HMAC-SHA256 signature of the request
 * body using a shared secret. The signature is computed over
 * `${method}\n${path}\n${timestamp}\n${body}` and sent in the
 * `X-TRM-Signature` header.
 *
 * Simulated response shape:
 *   - Address screening returns a list of `RiskIndicator` objects
 *     covering: sanctions, darknet, mixer, exchange, scam, terrorist_financing.
 *   - Each indicator has a `category`, `severity` (low|medium|high|severe),
 *     `confidence` (0..1), and `source` (e.g. "ofac", "chainanalysis").
 *
 * The compliance module (`src/protocol/compliance/aml.ts`) consumes
 * the risk indicators from this adapter alongside Chainalysis KYT
 * output to triangulate AML risk on crypto deposit/withdrawal flows.
 *
 * Evidence: source='third_party_attestation',
 * verificationLevel='attested', reputation=0.93, jurisdiction='US'.
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

/** Default config — TRM Labs API characteristics. */
export const DEFAULT_TRM_LABS_CONFIG: ProviderConfig = {
  id: 'trm_labs',
  type: 'compliance',
  name: 'TRM Labs',
  endpoint: 'https://api.trmlabs.com/v1',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 250,
  rateLimitRps: 20,
  rateLimitBurst: 40,
  idempotencyTtlMs: 60 * 60 * 1000,
  environment: 'production',
};

/** TRM Labs risk indicator categories. */
export type TrmRiskCategory =
  | 'sanctions'
  | 'darknet'
  | 'mixer'
  | 'exchange'
  | 'scam'
  | 'terrorist_financing'
  | 'stolen_funds'
  | 'ponzi_scheme'
  | 'gambling'
  | 'sanctions_entity';

export type TrmSeverity = 'low' | 'medium' | 'high' | 'severe';

export interface TrmRiskIndicator {
  category: TrmRiskCategory;
  severity: TrmSeverity;
  /** 0..1 confidence in the indicator. */
  confidence: number;
  /** Source list/feed (e.g. "ofac", "chainalysis", "trm_internal"). */
  source: string;
  /** Free-text description. */
  description?: string;
  /** Associated on-chain identifiers (tx hashes, cluster names). */
  references?: string[];
}

export interface TrmAddressScreening {
  chain: string;
  address: string;
  indicators: TrmRiskIndicator[];
  /** Aggregate risk score 0..100 derived from the indicator severities. */
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  /** TRM Labs account/entity identifier (if known). */
  accountId?: string;
  screenedAt: number;
}

export interface TrmTransactionScreening {
  chain: string;
  txHash: string;
  indicators: TrmRiskIndicator[];
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  counterpartyAddresses: string[];
  amount: string;
  amountUsd: number;
  screenedAt: number;
}

const SEVERITY_WEIGHT: Record<TrmSeverity, number> = {
  low: 10,
  medium: 30,
  high: 60,
  severe: 90,
};

/** Deterministic pseudo-risk from a string seed. */
function pseudoRisk(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 101;
}

function riskLevelFromScore(score: number): TrmAddressScreening['riskLevel'] {
  if (score >= 80) return 'severe';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Build a deterministic list of risk indicators for a seed. */
function synthesiseIndicators(seed: string, baseScore: number): TrmRiskIndicator[] {
  if (baseScore < 10) return [];
  const allCategories: TrmRiskCategory[] = [
    'sanctions', 'darknet', 'mixer', 'exchange', 'scam',
    'terrorist_financing', 'stolen_funds', 'ponzi_scheme', 'gambling', 'sanctions_entity',
  ];
  const sources = ['ofac', 'eu_consolidated', 'chainalysis', 'trm_internal', 'un_consolidated'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const positive = Math.abs(h);
  const count = Math.min(allCategories.length, Math.floor(baseScore / 15));
  const out: TrmRiskIndicator[] = [];
  for (let i = 0; i < count; i++) {
    const category = allCategories[(positive + i * 11) % allCategories.length];
    const sevRoll = (positive + i * 17) % 100;
    const severity: TrmSeverity =
      sevRoll < 25 ? 'low'
      : sevRoll < 55 ? 'medium'
      : sevRoll < 85 ? 'high'
      : 'severe';
    out.push({
      category,
      severity,
      confidence: round(0.5 + (positive % 50) / 100, 3),
      source: sources[(positive + i) % sources.length],
      description: `${category} exposure detected via ${sources[(positive + i) % sources.length]}`,
      references: [uid('trm_ref')],
    });
  }
  return out;
}

/** Aggregate indicators into a 0..100 risk score. */
function aggregateScore(indicators: TrmRiskIndicator[]): number {
  if (indicators.length === 0) return 0;
  const sum = indicators.reduce((acc, i) => acc + SEVERITY_WEIGHT[i.severity] * i.confidence, 0);
  return Math.min(100, Math.round(sum));
}

export class TrmLabsConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly addressCache = new Map<string, TrmAddressScreening>();
  private readonly txCache = new Map<string, TrmTransactionScreening>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_TRM_LABS_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate(request);
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'screenAddress':
        return this.screenAddress(request.params);
      case 'getAddressRiskIndicators':
        return this.getAddressRiskIndicators(request.params);
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
      attester: 'trm-labs-connector',
      reputation: 0.93,
      jurisdiction: 'US',
      payload: {
        operation: request.operation,
        requestId: request.id,
        provider: 'trm_labs',
        apiKeyId: this.providerConfig.apiKeyId,
        result,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate({ operation: 'healthCheck', params: {}, id: 'health' });
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /**
   * Simulated HMAC-SHA256 request signing. Real impl computes
   * `HMAC-SHA256(secret, "${method}\n${path}\n${timestamp}\n${body}")`
   * and sends the result as a hex string in the `X-TRM-Signature`
   * header, alongside the `TRM-API-Key` header.
   */
  private authenticate(request: ConnectorRequest): { ok: true; signature: string } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKey, hmacSecret } = this.providerConfig;
    if (!apiKey) {
      return { ok: false, error: authFailed('trm_labs: api_key required') };
    }
    if (!hmacSecret) {
      return { ok: false, error: authFailed('trm_labs: hmac_secret required') };
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const path = `/v1/${request.operation}`;
    const body = JSON.stringify(request.params);
    // Deterministic pseudo-signature (hex-shaped) over the canonical string.
    const canonical = `POST\n${path}\n${timestamp}\n${body}`;
    let h = 0;
    for (let i = 0; i < canonical.length; i++) h = (h * 31 + canonical.charCodeAt(i)) | 0;
    const signature = (h >>> 0).toString(16).padStart(8, '0') + uid('trm_sig').slice(-56);
    return { ok: true, signature };
  }

  // ------------------------------------------------------------- screenAddress
  private screenAddress(params: Record<string, unknown>): DoQueryResult {
    const chain = (params['chain'] as string | undefined)?.toLowerCase();
    const address = params['address'] as string | undefined;
    if (!chain || !address) {
      return { ok: false, error: invalidResponse('chain_address_required') };
    }
    const cacheKey = `${chain}:${address}`;
    let result = this.addressCache.get(cacheKey);
    if (!result) {
      const baseScore = pseudoRisk(cacheKey);
      const indicators = synthesiseIndicators(cacheKey, baseScore);
      const riskScore = aggregateScore(indicators);
      result = {
        chain,
        address,
        indicators,
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        accountId: baseScore > 50 ? `trm_acct_${uid('acct').slice(-8)}` : undefined,
        screenedAt: Date.now(),
      };
      this.addressCache.set(cacheKey, result);
    }
    return { ok: true, data: result };
  }

  // ----------------------------------------------- getAddressRiskIndicators
  private getAddressRiskIndicators(params: Record<string, unknown>): DoQueryResult {
    const inner = this.screenAddress(params);
    if (!inner.ok) return inner;
    const screening = inner.data as TrmAddressScreening;
    return {
      ok: true,
      data: {
        chain: screening.chain,
        address: screening.address,
        riskScore: screening.riskScore,
        riskLevel: screening.riskLevel,
        indicators: screening.indicators,
        recommendation:
          screening.riskLevel === 'severe' ? 'block'
          : screening.riskLevel === 'high' ? 'review'
          : screening.riskLevel === 'medium' ? 'monitor'
          : 'allow',
        screenedAt: screening.screenedAt,
      },
    };
  }

  // ----------------------------------------------------------- getTransactionRisk
  private getTransactionRisk(params: Record<string, unknown>): DoQueryResult {
    const chain = (params['chain'] as string | undefined)?.toLowerCase();
    const txHash = params['txHash'] as string | undefined;
    if (!chain || !txHash) {
      return { ok: false, error: invalidResponse('chain_txHash_required') };
    }
    const cacheKey = `${chain}:tx:${txHash}`;
    let result = this.txCache.get(cacheKey);
    if (!result) {
      const baseScore = pseudoRisk(cacheKey);
      const indicators = synthesiseIndicators(cacheKey, baseScore);
      const riskScore = aggregateScore(indicators);
      const amountUsd = round((Math.abs(pseudoRisk(cacheKey + 'amt')) * 250), 2);
      result = {
        chain,
        txHash,
        indicators,
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        counterpartyAddresses: [
          '0x' + '0'.repeat(38) + uid('cp1').slice(-2),
          '0x' + '0'.repeat(38) + uid('cp2').slice(-2),
        ],
        amount: String(Math.floor(amountUsd * 100)),
        amountUsd,
        screenedAt: Date.now(),
      };
      this.txCache.set(cacheKey, result);
    }
    return { ok: true, data: result };
  }
}
