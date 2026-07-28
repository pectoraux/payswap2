/**
 * PaySwap Protocol — Connector Architecture (v1).
 *
 * Connectors CANNOT modify state. They only produce Evidence.
 *
 *   Bank API response → Evidence { source, timestamp, signature, confidence }
 *   Blockchain event → Evidence { source, timestamp, signature, confidence }
 *   PSP confirmation → Evidence { source, timestamp, signature, confidence }
 *
 * The planner consumes evidence (via the Confidence Service), never connectors
 * directly. This makes replacing evidence sources trivial.
 *
 * TODO(HARDEN): A richer v2 connector module exists at `src/protocol/connectors-v2/`
 * (16 files, ~1900 lines) with retry / idempotency / rate-limiter. This v1 is
 * still used by 6 routes (`/api/protocol/health`, `/api/payment-links`,
 * `/api/payments`, ops pages, providers). Pick v2 as canonical, migrate the 6
 * v1 callers, then delete v1. Tracked by HARDEN-1 audit (duplicate services table).
 */
import { createEvidence, type Evidence, type EvidenceSource, type VerificationLevel } from '@/kernel/evidence';
import { uid } from '@/kernel/support';

export interface ConnectorConfig {
  id: string;
  type: ConnectorType;
  name: string;
  endpoint?: string;
  apiKey?: string;
  timeout: number;
  retryCount: number;
}

export type ConnectorType = 'bank' | 'blockchain' | 'mobile_money' | 'psp' | 'exchange';

export interface ConnectorResult {
  success: boolean;
  evidence?: Evidence;
  error?: string;
  latencyMs: number;
}

export abstract class Connector {
  constructor(protected config: ConnectorConfig) {}

  abstract query(params: Record<string, unknown>): Promise<ConnectorResult>;
  abstract healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  protected createEvidence(
    entityId: string,
    source: EvidenceSource,
    verificationLevel: VerificationLevel,
    attestedAmount: number,
    currency: string,
    attestedValue: string,
    reputation: number = 0.8,
    ttlMs: number = 60000,
  ): Evidence {
    return createEvidence({
      type: 'attestation',
      source,
      verificationLevel,
      entityId,
      attestedAmount,
      currency,
      reputation,
      attester: this.config.id,
      ttlMs,
      payload: { connector: this.config.id, connectorType: this.config.type, attestedValue },
    });
  }
}

// ─── Bank Connector ─────────────────────────────────────────────────────────

export class BankConnector extends Connector {
  async query(params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const accountId = params.accountId as string;
      const currency = params.currency as string;

      // In production: call bank API (Open Banking, PSD2, etc.)
      // For now: simulate a response
      const balance = params.expectedBalance as number ?? Math.floor(Math.random() * 100000);

      return {
        success: true,
        evidence: this.createEvidence(
          `account:${accountId}`,
          'open_banking',
          'institutional',
          balance,
          currency,
          `${balance} ${currency} available`,
          0.9,
          60000,
        ),
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Bank query failed', latencyMs: Date.now() - start };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    // In production: ping bank API health endpoint
    return { healthy: true, latencyMs: Date.now() - start };
  }
}

// ─── Blockchain Connector ───────────────────────────────────────────────────

export class BlockchainConnector extends Connector {
  async query(params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const txHash = params.txHash as string;
      const contractAddress = params.contractAddress as string;

      // In production: query blockchain (Ethereum, Polygon, etc.)
      // For now: simulate on-chain verification
      const confirmed = params.confirmed as boolean ?? true;
      const amount = params.amount as number ?? 0;
      const currency = params.currency as string ?? 'TWIN';

      return {
        success: true,
        evidence: this.createEvidence(
          `tx:${txHash}`,
          'on_chain_state',
          'cryptographic',
          amount,
          currency,
          `On-chain: ${txHash} on ${contractAddress}`,
          1.0,
          999999999, // on-chain is permanent
        ),
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Blockchain query failed', latencyMs: Date.now() - start };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 50 };
  }
}

// ─── Mobile Money Connector ─────────────────────────────────────────────────

export class MobileMoneyConnector extends Connector {
  async query(params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const phoneNumber = params.phoneNumber as string;
      const provider = params.provider as string;
      const balance = params.balance as number ?? Math.floor(Math.random() * 50000);
      const currency = params.currency as string ?? 'KES';

      return {
        success: true,
        evidence: this.createEvidence(
          `mmo:${phoneNumber}`,
          'psp_confirmation',
          'institutional',
          balance,
          currency,
          `${balance} ${currency} on ${provider}`,
          0.85,
          60000,
        ),
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Mobile money query failed', latencyMs: Date.now() - start };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 200 };
  }
}

// ─── PSP Connector ──────────────────────────────────────────────────────────

export class PSPConnector extends Connector {
  async query(params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const transactionId = params.transactionId as string;
      const status = params.status as string ?? 'completed';
      const amount = params.amount as number ?? 0;
      const currency = params.currency as string ?? 'GHS';

      return {
        success: true,
        evidence: this.createEvidence(
          `psp:${transactionId}`,
          'psp_confirmation',
          'institutional',
          amount,
          currency,
          `PSP transaction ${transactionId}: ${status}`,
          0.88,
          90000,
        ),
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'PSP query failed', latencyMs: Date.now() - start };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 150 };
  }
}

// ─── Exchange Connector ─────────────────────────────────────────────────────

export class ExchangeConnector extends Connector {
  async query(params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const fromCurrency = params.fromCurrency as string;
      const toCurrency = params.toCurrency as string;
      const rate = params.rate as number ?? 1.0;

      return {
        success: true,
        evidence: this.createEvidence(
          `fx:${fromCurrency}-${toCurrency}`,
          'third_party_attestation',
          'attested',
          rate,
          toCurrency,
          `FX rate: 1 ${fromCurrency} = ${rate} ${toCurrency}`,
          0.8,
          30000, // FX rates expire fast
        ),
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Exchange query failed', latencyMs: Date.now() - start };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 100 };
  }
}

// ─── Connector Registry ─────────────────────────────────────────────────────

export class ConnectorRegistry {
  private connectors: Map<string, Connector> = new Map();
  private health: Map<string, { healthy: boolean; lastCheck: number; latencyMs: number }> = new Map();

  register(connector: Connector): void {
    this.connectors.set(connector['config'].id, connector);
    this.health.set(connector['config'].id, { healthy: true, lastCheck: 0, latencyMs: 0 });
  }

  get(connectorId: string): Connector | undefined { return this.connectors.get(connectorId); }
  all(): Connector[] { return [...this.connectors.values()]; }

  async query(connectorId: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    const connector = this.connectors.get(connectorId);
    if (!connector) return { success: false, error: 'Connector not found', latencyMs: 0 };
    const result = await connector.query(params);
    if (!result.success) {
      this.health.set(connectorId, { healthy: false, lastCheck: Date.now(), latencyMs: result.latencyMs });
    }
    return result;
  }

  async healthCheckAll(): Promise<Map<string, { healthy: boolean; latencyMs: number }>> {
    const results = new Map<string, { healthy: boolean; latencyMs: number }>();
    for (const [id, connector] of this.connectors) {
      const health = await connector.healthCheck();
      results.set(id, health);
      this.health.set(id, { healthy: health.healthy, lastCheck: Date.now(), latencyMs: health.latencyMs });
    }
    return results;
  }

  getHealth(connectorId: string): { healthy: boolean; lastCheck: number; latencyMs: number } | undefined {
    return this.health.get(connectorId);
  }

  reset(): void { this.connectors.clear(); this.health.clear(); }
}

export const connectorRegistry = new ConnectorRegistry();
