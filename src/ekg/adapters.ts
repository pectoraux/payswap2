/**
 * Economic Knowledge Graph — Provider Adapter Framework.
 *
 * PHASE 6: Real-world integrations. Every external system (banking API, KYC
 * provider, card processor, mobile money, stablecoin custody) becomes a
 * provider adapter that implements a standard interface. The adapter registers
 * as an entity in the graph, offers capabilities, and participates in proofs.
 *
 * Adding a real provider (e.g. Stripe, Ecobank, Smile ID, MTN MoMo) is:
 *   1. Implement the ProviderAdapter interface.
 *   2. Register it via the provider registry.
 *   3. The graph treats it as an entity offering capabilities.
 *   4. The planner can now route proofs through it.
 *   5. resolve() discovers it automatically.
 *
 * No special cases. No hardcoded integrations. Every provider is just another
 * node in the graph.
 */

import { ekg } from './graph';
import { appendEvent } from './event-log';
import type { EntityLabel } from './types';
import { Money } from '@/money';

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER ADAPTER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The result of invoking a provider adapter. Adapters return a structured
 * result that the execution kernel uses to update the graph.
 */
export interface AdapterInvocationResult {
  /** Whether the invocation succeeded. */
  success: boolean;
  /** The assets produced (asset node ids + amounts as Money). */
  producedAssets: Array<{ assetId: string; amount: Money }>;
  /** The assets consumed. */
  consumedAssets: Array<{ assetId: string; amount: Money }>;
  /** The cost charged (as exact Money — no float). */
  cost: Money;
  /** Latency in ms. */
  latencyMs: number;
  /** Human-readable detail. */
  detail: string;
  /** Error message (if !success). */
  error?: string;
  /** Provider-specific raw response (for debugging). */
  rawResponse?: Record<string, unknown>;
}

/**
 * The standard interface every real-world provider implements. Adapters wrap
 * external APIs (Stripe, Ecobank, Smile ID, MTN MoMo, etc.) and expose them
 * as capability providers in the graph.
 */
export interface ProviderAdapter {
  /** The adapter id (stable, e.g. 'stripe', 'ecobank', 'smile-id', 'mtn-momo'). */
  id: string;
  /** Display name. */
  name: string;
  /** The entity label (ORGANIZATION, API, BANK, etc.). */
  label: EntityLabel;
  /** Description. */
  description: string;
  /** The capabilities this adapter offers. */
  offers: AdapterCapabilityOffer[];
  /** Whether the adapter is currently enabled. */
  enabled: boolean;
  /** Jurisdictions where the provider operates. */
  jurisdictions: string[];
  /** Carbon footprint per invocation (kgCO2e). */
  carbonPerInvocation: number;

  /**
   * Invoke a capability. This is where the adapter calls the real external API.
   * In production, this makes HTTP calls to Stripe/Ecobank/etc. In the mock
   * implementation, it simulates the call.
   */
  invoke(capabilityId: string, inputs: Record<string, unknown>): Promise<AdapterInvocationResult>;

  /**
   * Health check — is the provider reachable?
   */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; detail: string }>;
}

/**
 * A capability offer from an adapter — what the adapter can do, for what price.
 */
export interface AdapterCapabilityOffer {
  /** The capability node id in the graph (must exist). */
  capabilityId: string;
  /** Price per invocation (as exact Money — no float). */
  pricePerInvocation: Money;
  /** Typical latency in ms. */
  latencyMs: number;
  /** SLA success rate (0–1). */
  slaSuccessRate: number;
  /** Max concurrent invocations. */
  capacity: number;
  /** Region. */
  region: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const globalForAdapters = globalThis as unknown as {
  __PAYSWAP_PROVIDER_ADAPTERS__?: Map<string, ProviderAdapter>;
};

export const adapterRegistry: Map<string, ProviderAdapter> =
  globalForAdapters.__PAYSWAP_PROVIDER_ADAPTERS__ ?? new Map();
if (!globalForAdapters.__PAYSWAP_PROVIDER_ADAPTERS__) {
  globalForAdapters.__PAYSWAP_PROVIDER_ADAPTERS__ = adapterRegistry;
}

/**
 * Register a provider adapter. This:
 *   1. Stores the adapter in the registry.
 *   2. Creates (or updates) an ENTITY node in the graph for this provider.
 *   3. Creates OFFERS relationships from the entity to each capability.
 *   4. Creates LOCATED_IN relationships to jurisdictions.
 *   5. Emits events for all of the above (the graph is event-sourced).
 */
export function registerAdapter(adapter: ProviderAdapter): string {
  adapterRegistry.set(adapter.id, adapter);

  // Check if the entity already exists (by searching for a node with this stableId)
  const existing = ekg.listNodes({ kind: 'ENTITY' }).find((n) => n.properties.adapterId === adapter.id);
  let entityId: string;

  const entityProps = {
    adapterId: adapter.id,
    trustScore: 85, // default — would be learned over time
    reputation: 80,
    revenue: 0,
    costs: 0,
    invocations: 0,
    reliabilityScore: 85,
    reliabilityTrend: 'STABLE',
    carbonPerInvocation: adapter.carbonPerInvocation,
  };

  if (existing) {
    entityId = existing.id;
    ekg.updateNode(entityId, entityProps);
  } else {
    entityId = ekg.addNode('ENTITY', adapter.name, entityProps, [adapter.label]);
  }

  // Create OFFERS relationships for each capability
  for (const offer of adapter.offers) {
    // Check if the capability exists in the graph
    const cap = ekg.getNode(offer.capabilityId);
    if (!cap) continue; // skip if capability doesn't exist

    // Check if the OFFERS relationship already exists
    const existingOffers = ekg.getRelationshipsByType(entityId, 'OFFERS');
    const alreadyOffered = existingOffers.some((r) => r.to === offer.capabilityId);
    if (!alreadyOffered) {
      ekg.addRelationship(entityId, offer.capabilityId, 'OFFERS', {
        pricePerInvocation: offer.pricePerInvocation.toNumber(),
        priceMinorUnits: offer.pricePerInvocation.minorUnits.toString(),
        priceCurrency: offer.pricePerInvocation.currency,
        latencyMs: offer.latencyMs,
        slaSuccessRate: offer.slaSuccessRate,
        capacity: offer.capacity,
        region: offer.region,
      });
    }
  }

  // Create LOCATED_IN relationships for jurisdictions
  for (const jurisCode of adapter.jurisdictions) {
    const jurisNodes = ekg.listNodes({ kind: 'JURISDICTION' });
    const juris = jurisNodes.find((j) => j.properties.code === jurisCode.toUpperCase());
    if (juris) {
      const existingLocs = ekg.getRelationshipsByType(entityId, 'LOCATED_IN');
      if (!existingLocs.some((r) => r.to === juris.id)) {
        ekg.addRelationship(entityId, juris.id, 'LOCATED_IN');
      }
    }
  }

  return entityId;
}

/** Get an adapter by id. */
export function getAdapter(id: string): ProviderAdapter | undefined {
  return adapterRegistry.get(id);
}

/** List all registered adapters. */
export function listAdapters(): ProviderAdapter[] {
  return Array.from(adapterRegistry.values());
}

/** Enable/disable an adapter. */
export function setAdapterEnabled(id: string, enabled: boolean): boolean {
  const adapter = adapterRegistry.get(id);
  if (!adapter) return false;
  (adapter as { enabled: boolean }).enabled = enabled;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK PROVIDER IMPLEMENTATIONS
// Real providers implement the same interface but make real HTTP calls.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stripe — card payment processing.
 * In production, this calls Stripe's API. Here it's a mock that simulates
 * the same interface.
 */
export class StripeAdapter implements ProviderAdapter {
  id = 'stripe';
  name = 'Stripe';
  label: EntityLabel = 'API';
  description = 'Card payment processing API. Settles payments via card rails.';
  enabled = true;
  jurisdictions = ['US', 'EU'];
  carbonPerInvocation = 0.005;

  offers: AdapterCapabilityOffer[] = [];

  constructor() {
    // The capabilityId will be resolved at registration time (the graph may not be seeded yet)
    // We use a placeholder that registerAdapter resolves
    this.offers = [];
  }

  async invoke(capabilityId: string, inputs: Record<string, unknown>): Promise<AdapterInvocationResult> {
    // Mock: simulate a Stripe charge
    const amount = Money.fromMajor(String(inputs.amount ?? 0), 'USD');
    const fee = amount.percentage(2.9); // 2.9% Stripe fee

    return {
      success: true,
      producedAssets: [
        { assetId: 'asset.payment_receipt', amount: Money.fromMajor(1, 'USD') },
      ],
      consumedAssets: [
        { assetId: 'asset.usd', amount },
      ],
      cost: fee,
      latencyMs: 500,
      detail: `Stripe charged ${amount.toString()} (fee: ${fee.toString()})`,
      rawResponse: { charge_id: `ch_mock_${Date.now()}`, amount: amount.toMajorString(), fee: fee.toMajorString() },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; detail: string }> {
    return { healthy: true, latencyMs: 45, detail: 'Stripe API reachable' };
  }
}

/**
 * Ecobank — bank transfer settlement.
 */
export class EcobankAdapter implements ProviderAdapter {
  id = 'ecobank';
  name = 'Ecobank';
  label: EntityLabel = 'BANK';
  description = 'Pan-African bank transfer settlement. Settles via bank rails across GH, NG, KE, TG.';
  enabled = true;
  jurisdictions = ['GH', 'NG', 'KE', 'TG'];
  carbonPerInvocation = 0.01;

  offers: AdapterCapabilityOffer[] = [];

  async invoke(capabilityId: string, inputs: Record<string, unknown>): Promise<AdapterInvocationResult> {
    const amount = Money.fromMajor(String(inputs.amount ?? 0), 'USD');
    const fee = amount.percentage(1.5);

    return {
      success: true,
      producedAssets: [
        { assetId: 'asset.payment_receipt', amount: Money.fromMajor(1, 'USD') },
      ],
      consumedAssets: [
        { assetId: 'asset.usd', amount },
      ],
      cost: fee,
      latencyMs: 800,
      detail: `Ecobank transferred ${amount.toString()} (fee: ${fee.toString()})`,
      rawResponse: { transfer_id: `ecb_${Date.now()}`, amount: amount.toMajorString() },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; detail: string }> {
    return { healthy: true, latencyMs: 120, detail: 'Ecobank API reachable' };
  }
}

/**
 * Smile ID — KYC/identity verification.
 */
export class SmileIDAdapter implements ProviderAdapter {
  id = 'smile-id';
  name = 'Smile ID';
  label: EntityLabel = 'API';
  description = 'African KYC/identity verification. Verifies passports, national IDs, biometrics.';
  enabled = true;
  jurisdictions = ['GH', 'NG', 'KE', 'TG'];
  carbonPerInvocation = 0.002;

  offers: AdapterCapabilityOffer[] = [];

  async invoke(capabilityId: string, inputs: Record<string, unknown>): Promise<AdapterInvocationResult> {
    return {
      success: true,
      producedAssets: [
        { assetId: 'asset.identity', amount: Money.fromMajor(1, 'USD') },
        { assetId: 'asset.kyc_evidence', amount: Money.fromMajor(1, 'USD') },
      ],
      consumedAssets: [],
      cost: Money.fromMajor(0.15, 'USD'),
      latencyMs: 2400,
      detail: `Smile ID verified identity for ${inputs.userId ?? 'unknown user'}`,
      rawResponse: { verification_id: `sid_${Date.now()}`, status: 'verified' },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; detail: string }> {
    return { healthy: true, latencyMs: 80, detail: 'Smile ID API reachable' };
  }
}

/**
 * MTN MoMo — mobile money settlement.
 */
export class MTNMoMoAdapter implements ProviderAdapter {
  id = 'mtn-momo';
  name = 'MTN MoMo';
  label: EntityLabel = 'API';
  description = 'MTN Mobile Money settlement. Settles payments via mobile money wallets across Africa.';
  enabled = true;
  jurisdictions = ['GH', 'NG', 'KE', 'TG'];
  carbonPerInvocation = 0.003;

  offers: AdapterCapabilityOffer[] = [];

  async invoke(capabilityId: string, inputs: Record<string, unknown>): Promise<AdapterInvocationResult> {
    const amount = Money.fromMajor(String(inputs.amount ?? 0), 'USD');
    const fee = amount.percentage(1.0);

    return {
      success: true,
      producedAssets: [
        { assetId: 'asset.payment_receipt', amount: Money.fromMajor(1, 'USD') },
      ],
      consumedAssets: [
        { assetId: 'asset.usd', amount },
      ],
      cost: fee,
      latencyMs: 1200,
      detail: `MTN MoMo transferred ${amount.toString()} to ${inputs.phone ?? 'unknown'}`,
      rawResponse: { transaction_id: `momo_${Date.now()}`, status: 'success' },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; detail: string }> {
    return { healthy: true, latencyMs: 60, detail: 'MTN MoMo API reachable' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER SEEDING — register mock adapters after the graph is seeded
// ═══════════════════════════════════════════════════════════════════════════

const globalForAdapterSeed = globalThis as unknown as { __PAYSWAP_ADAPTERS_SEEDED__?: boolean };

/**
 * Register mock adapters. Called after the graph is seeded so capability ids
 * are available. In production, real adapters replace these mocks.
 */
export function seedAdapters(): void {
  if (globalForAdapterSeed.__PAYSWAP_ADAPTERS_SEEDED__) return;
  globalForAdapterSeed.__PAYSWAP_ADAPTERS_SEEDED__ = true;

  // Find capability ids by searching the graph
  const capabilities = ekg.listNodes({ kind: 'CAPABILITY' });
  const findCap = (name: string) => capabilities.find((c) => c.label === name)?.id;

  const settlePaymentCap = findCap('Settle Payment');
  const verifyIdentityCap = findCap('Verify Identity');

  // ── Stripe ──
  const stripe = new StripeAdapter();
  if (settlePaymentCap) {
    stripe.offers = [{
      capabilityId: settlePaymentCap,
      pricePerInvocation: Money.fromMajor(0.029, 'USD'),
      latencyMs: 500,
      slaSuccessRate: 0.9999,
      capacity: 50000,
      region: 'global',
    }];
  }
  registerAdapter(stripe);

  // ── Ecobank ──
  const ecobank = new EcobankAdapter();
  if (settlePaymentCap) {
    ecobank.offers = [{
      capabilityId: settlePaymentCap,
      pricePerInvocation: Money.fromMajor(0.015, 'USD'),
      latencyMs: 800,
      slaSuccessRate: 0.9995,
      capacity: 5000,
      region: 'GH',
    }];
  }
  registerAdapter(ecobank);

  // ── Smile ID ──
  const smileID = new SmileIDAdapter();
  if (verifyIdentityCap) {
    smileID.offers = [{
      capabilityId: verifyIdentityCap,
      pricePerInvocation: Money.fromMajor(0.15, 'USD'),
      latencyMs: 2400,
      slaSuccessRate: 0.998,
      capacity: 1000,
      region: 'GH',
    }];
  }
  registerAdapter(smileID);

  // ── MTN MoMo ──
  const mtnMoMo = new MTNMoMoAdapter();
  if (settlePaymentCap) {
    mtnMoMo.offers = [{
      capabilityId: settlePaymentCap,
      pricePerInvocation: Money.fromMajor(0.01, 'USD'),
      latencyMs: 1200,
      slaSuccessRate: 0.999,
      capacity: 10000,
      region: 'GH',
    }];
  }
  registerAdapter(mtnMoMo);
}

// Auto-seed after a delay (to ensure the graph is seeded first)
// In practice, this is called by the API on first access
let seeded = false;
export function ensureAdaptersSeeded(): void {
  if (seeded) return;
  try {
    seedAdapters();
    seeded = true;
  } catch {
    // graph not seeded yet — will retry on next call
  }
}
