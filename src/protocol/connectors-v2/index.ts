/**
 * PaySwap Protocol — Production Connectors v2 — Barrel Export.
 *
 * Production-grade connectors with: authentication, retry, timeouts, rate
 * limits, health monitoring, metrics, idempotency, structured errors, audit
 * logs, and signed evidence.
 *
 * Connectors CANNOT modify protocol state. They ONLY produce Evidence.
 * A connector returning `{ success: false }` must not have mutated any
 * protocol module's state — enforced by construction (connectors hold no
 * protocol refs).
 *
 * Quick start:
 *   import { productionConnectorRegistry, signedEvidence } from '@/protocol/connectors-v2';
 *
 *   const res = await productionConnectorRegistry.query('open_banking', {
 *     id: 'idem-001', operation: 'getBalance', params: { accountId: 'GB001', currency: 'GBP' },
 *   });
 *   if (res.success) {
 *     console.log(res.evidence);              // signed Evidence
 *     console.log(res.evidence.payload.signature); // 'hmac-sha256:...'
 *   }
 */
import { createHmac } from 'crypto';
import { createEvidence, type Evidence, type EvidenceSource, type VerificationLevel } from '@/kernel/evidence';
import { productionConnectorRegistry } from './registry';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  ConnectorId,
  ConnectorType,
  ConnectorConfig,
  ConnectorRequest,
  ConnectorResponse,
  ConnectorError,
  ConnectorErrorCode,
  ConnectorHealth,
  ConnectorMetrics,
} from './types';

// ─── Errors ──────────────────────────────────────────────────────────────────
export {
  authFailed,
  rateLimited,
  timeout,
  upstream5xx,
  upstream4xx,
  network,
  invalidResponse,
  insufficientFunds,
  accountFrozen,
  unknownError,
  isRetryable,
  fromHttpError,
} from './errors';

// ─── Retry ───────────────────────────────────────────────────────────────────
export {
  defaultRetryPolicy,
  computeBackoff,
  executeWithRetry,
  sleep,
  type RetryPolicy,
} from './retry';

// ─── Rate Limiter ────────────────────────────────────────────────────────────
export { TokenBucketRateLimiter } from './rate-limiter';

// ─── Idempotency ─────────────────────────────────────────────────────────────
export { IdempotencyStore } from './idempotency';

// ─── Health ──────────────────────────────────────────────────────────────────
export { HealthMonitor, sharedHealthMonitor, type HealthMonitorOptions } from './health';

// ─── Metrics ─────────────────────────────────────────────────────────────────
export { MetricsCollector, sharedMetricsCollector, percentile } from './metrics';

// ─── Audit ───────────────────────────────────────────────────────────────────
export {
  AuditLog,
  auditLogInstance,
  auditLog,
  getAuditLog,
  type AuditEntry,
  type AuditFilter,
} from './audit';

// ─── Base ────────────────────────────────────────────────────────────────────
export { ProductionConnector, buildAttestationEvidence, type ProductionConnectorDeps } from './base';

// ─── Connectors ──────────────────────────────────────────────────────────────
export { OpenBankingConnector, deterministicHash } from './open-banking';
export { MpesaConnector } from './mpesa';
export { EthereumRpcConnector } from './ethereum-rpc';
export { FxRateConnector } from './fx-rate';
export { StellarHorizonConnector } from './stellar-horizon';

// ─── Registry ────────────────────────────────────────────────────────────────
export {
  ProductionConnectorRegistry,
  productionConnectorRegistry,
  bootstrapProductionConnectors,
} from './registry';

// ─── Signed Evidence Helper ──────────────────────────────────────────────────

/**
 * Create a signed Evidence object.
 *
 * Computes HMAC-SHA256 over the canonical evidence payload using the
 * connector's resolved secret. The signature is stored in `evidenceHash`
 * (replacing the kernel's placeholder) and in `payload.signature`.
 *
 * If the connector is not registered or its secret is not resolved, the
 * signature is a placeholder string prefixed with `unsigned:`. Downstream
 * consumers can check `payload.signatureAlgorithm` to verify.
 *
 * @param connectorId  Which connector's secret to sign with.
 * @param params       Evidence creation parameters (source, verificationLevel,
 *                     entityId, attestedAmount, currency, etc.).
 * @returns            Signed Evidence object.
 */
export function signedEvidence(
  connectorId: import('./types').ConnectorId,
  params: {
    type?: import('@/kernel/evidence').EvidenceType;
    source: EvidenceSource;
    verificationLevel: VerificationLevel;
    entityId: string;
    attestedAmount?: number;
    currency?: string;
    reputation?: number;
    jurisdiction?: string;
    attester?: string;
    ttlMs?: number;
    payload?: Record<string, unknown>;
  },
): Evidence {
  // Resolve the connector + its secret.
  const connector = productionConnectorRegistry.get(connectorId);
  const secret = connector?.getSecret() ?? '';
  const attester = params.attester ?? connectorId;

  // Build the evidence via the kernel's createEvidence.
  const evidence = createEvidence({
    type: params.type ?? 'attestation',
    source: params.source,
    verificationLevel: params.verificationLevel,
    entityId: params.entityId,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    reputation: params.reputation,
    jurisdiction: params.jurisdiction,
    attester,
    ttlMs: params.ttlMs,
    payload: params.payload,
  });

  // Compute HMAC-SHA256 over a canonical string.
  const canonical = `${evidence.id}|${evidence.issuedAt}|${JSON.stringify(evidence.payload)}`;
  if (!secret) {
    // No secret available — record a placeholder signature.
    evidence.evidenceHash = `unsigned:${simpleHash(canonical)}`;
    evidence.payload = {
      ...evidence.payload,
      signature: null,
      signatureAlgorithm: 'NONE',
      signedBy: connectorId,
    };
    return evidence;
  }
  const hmac = createHmac('sha256', secret);
  hmac.update(canonical);
  const signature = `hmac-sha256:${hmac.digest('hex')}`;
  evidence.evidenceHash = signature;
  evidence.payload = {
    ...evidence.payload,
    signature,
    signatureAlgorithm: 'HMAC-SHA256',
    signedBy: connectorId,
    signedAt: Date.now(),
  };
  return evidence;
}

/** Simple non-cryptographic string hash (for placeholder signatures). */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
