/**
 * Economic Computation Platform — Central Store.
 *
 * Holds: capability registry, provider registry (heterogeneous), asset types,
 * goals, proofs, economic memory, and learned provider scores.
 *
 * Process-wide singleton on globalThis.
 */

import { uid } from '@/runtime/types';
import type {
  Capability, CapabilityProvider, ProviderKind, ProviderOffer, ProviderStatus,
  AssetType, AssetTypeCategory,
  Goal, AssetBinding, ConstraintBundle,
  EconomicProof, VerificationResult,
  EconomicMemoryRecord, ProviderLearningScore,
  UnifiedGraph, GraphNode, GraphEdge,
  PlatformOverview,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export interface PlatformStore {
  capabilities: Map<string, Capability>;
  providers: Map<string, CapabilityProvider>;
  assetTypes: Map<string, AssetType>;
  goals: Map<string, Goal>;
  proofs: EconomicProof[];
  memory: EconomicMemoryRecord[];
  learningScores: Map<string, ProviderLearningScore>; // key = `${providerId}::${capabilityId}`
}

function createStore(): PlatformStore {
  return { capabilities: new Map(), providers: new Map(), assetTypes: new Map(), goals: new Map(), proofs: [], memory: [], learningScores: new Map() };
}

const globalForPlatform = globalThis as unknown as {
  __PAYSWAP_PLATFORM_STORE__?: PlatformStore;
  __PAYSWAP_PLATFORM_SEEDED__?: boolean;
};

export const platformStore: PlatformStore =
  globalForPlatform.__PAYSWAP_PLATFORM_STORE__ ?? createStore();
if (!globalForPlatform.__PAYSWAP_PLATFORM_STORE__) {
  globalForPlatform.__PAYSWAP_PLATFORM_STORE__ = platformStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE OBJECT
// ═══════════════════════════════════════════════════════════════════════════

export interface PlatformService {
  listCapabilities(): Capability[];
  getCapability(id: string): Capability | undefined;
  listProviders(filter?: { kind?: ProviderKind; offersCapability?: string }): CapabilityProvider[];
  getProvider(id: string): CapabilityProvider | undefined;
  listAssetTypes(): AssetType[];
  listGoals(): Goal[];
  getGoal(id: string): Goal | undefined;
  listProofs(limit?: number): EconomicProof[];
  getProof(id: string): EconomicProof | undefined;
  listMemory(limit?: number): EconomicMemoryRecord[];
  listLearningScores(): ProviderLearningScore[];
  buildGraph(): UnifiedGraph;
  overview(): PlatformOverview;
}

export const platform: PlatformService = {
  listCapabilities() { return Array.from(platformStore.capabilities.values()).sort((a, b) => a.id.localeCompare(b.id)); },
  getCapability(id) { return platformStore.capabilities.get(id); },
  listProviders(filter) {
    let rows = Array.from(platformStore.providers.values());
    if (filter?.kind) rows = rows.filter((p) => p.kind === filter.kind);
    if (filter?.offersCapability) rows = rows.filter((p) => p.offers.some((o) => o.capabilityId === filter.offersCapability));
    return rows.sort((a, b) => b.revenue - a.revenue);
  },
  getProvider(id) { return platformStore.providers.get(id); },
  listAssetTypes() { return Array.from(platformStore.assetTypes.values()); },
  listGoals() { return Array.from(platformStore.goals.values()).sort((a, b) => a.createdAt - b.createdAt); },
  getGoal(id) { return platformStore.goals.get(id); },
  listProofs(limit) { const r = platformStore.proofs; return limit ? r.slice(0, limit) : r; },
  getProof(id) { return platformStore.proofs.find((p) => p.id === id); },
  listMemory(limit) { const r = platformStore.memory; return limit ? r.slice(0, limit) : r; },
  listLearningScores() { return Array.from(platformStore.learningScores.values()).sort((a, b) => b.learnedScore - a.learnedScore); },
  buildGraph() { return buildUnifiedGraph(); },
  overview() {
    const providers = Array.from(platformStore.providers.values());
    const mem = platformStore.memory;
    const graph = buildUnifiedGraph();
    return {
      capabilityCount: platformStore.capabilities.size,
      providerCount: providers.length,
      providerKindCount: new Set(providers.map((p) => p.kind)).size,
      assetTypeCount: platformStore.assetTypes.size,
      goalCount: platformStore.goals.size,
      proofCount: platformStore.proofs.length,
      settledProofCount: platformStore.proofs.filter((p) => p.status === 'settled').length,
      memoryRecordCount: mem.length,
      avgSuccessRate: mem.length ? (mem.filter((m) => m.outcome === 'SUCCESS').length / mem.length) * 100 : 0,
      totalExecutions: mem.length,
      graphNodeCount: graph.nodes.length,
      graphEdgeCount: graph.edges.length,
      learningEntries: platformStore.learningScores.size,
    };
  },
};

function buildUnifiedGraph(): UnifiedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeSet = new Set<string>();

  const addNode = (id: string, kind: GraphNode['kind'], label: string, sublabel?: string, group?: string, color?: string) => {
    if (nodeSet.has(id)) return;
    nodeSet.add(id);
    nodes.push({ id, kind, label, sublabel, group, color });
  };

  // Capability nodes
  for (const cap of platformStore.capabilities.values()) {
    addNode(cap.id, 'CAPABILITY', cap.name, cap.category, cap.category, 'violet');
  }
  // Provider nodes
  for (const p of platformStore.providers.values()) {
    const meta = PROVIDER_KIND_COLOR[p.kind];
    addNode(p.id, 'PROVIDER', p.name, p.kind, p.kind, meta);
  }
  // Asset type nodes
  for (const a of platformStore.assetTypes.values()) {
    addNode(a.id, 'ASSET', a.name, a.category, a.category, ASSET_CATEGORY_COLOR[a.category]);
  }
  // Goal nodes
  for (const g of platformStore.goals.values()) {
    addNode(g.id, 'GOAL', g.name, g.category, g.category, 'emerald');
  }

  // Edges: provider -offers-> capability
  for (const p of platformStore.providers.values()) {
    for (const offer of p.offers) {
      edges.push({ from: p.id, to: offer.capabilityId, kind: 'offers', weight: offer.pricePerInvocation });
    }
  }
  // Edges: capability -produces-> asset
  for (const cap of platformStore.capabilities.values()) {
    for (const a of cap.produces) edges.push({ from: cap.id, to: a, kind: 'produces' });
    for (const a of cap.requires) edges.push({ from: cap.id, to: a, kind: 'consumes' });
  }
  // Edges: goal -requires-> target asset
  for (const g of platformStore.goals.values()) {
    edges.push({ from: g.id, to: g.targetAsset, kind: 'requires' });
  }

  return { nodes, edges };
}

const PROVIDER_KIND_COLOR: Record<ProviderKind, string> = {
  ORGANIZATION: 'emerald', AI_MODEL: 'violet', HUMAN: 'amber', API: 'sky',
  IOT_DEVICE: 'orange', BANK: 'teal', GOVERNMENT: 'rose', BLOCKCHAIN: 'fuchsia',
};

const ASSET_CATEGORY_COLOR: Record<AssetTypeCategory, string> = {
  CURRENCY: 'emerald', CREDENTIAL: 'sky', REPUTATION: 'fuchsia', BANDWIDTH: 'lime',
  ATTENTION: 'amber', CARBON: 'lime', ENERGY: 'orange', IDENTITY: 'sky',
  TIME: 'slate', GPU: 'violet', CPU: 'violet', STORAGE: 'cyan', RISK: 'rose',
  KNOWLEDGE: 'indigo', PROOF: 'teal', OWNERSHIP: 'amber', GOVERNANCE: 'rose',
  LICENSE: 'slate', API_CALL: 'sky', INFERENCE: 'violet', RESERVATION: 'amber',
  QUOTA: 'cyan', PROMISE: 'teal', DEBT: 'rose', INSURANCE: 'cyan', ROUTE: 'lime',
  CAPACITY: 'lime', RECEIPT: 'gray', EVIDENCE: 'purple', RIGHT: 'violet',
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED — capabilities, heterogeneous providers, asset types, goals, memory
// ═══════════════════════════════════════════════════════════════════════════

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => Date.now() - ms;

// ── Asset types (28 categories) ──────────────────────────────────────────────
const SEED_ASSET_TYPES: AssetType[] = [
  { id: 'currency.usd', name: 'USD', category: 'CURRENCY', unit: 'USD', color: 'emerald', description: 'US Dollar' },
  { id: 'currency.ghs', name: 'GHS', category: 'CURRENCY', unit: 'GHS', color: 'emerald', description: 'Ghana Cedi' },
  { id: 'credential.identity', name: 'Verified Identity', category: 'CREDENTIAL', unit: 'cred', color: 'sky', description: 'KYC-verified identity' },
  { id: 'credential.enrollment', name: 'Enrollment', category: 'CREDENTIAL', unit: 'cred', color: 'sky', description: 'Course enrollment credential' },
  { id: 'credential.skill', name: 'Skill', category: 'CREDENTIAL', unit: 'cred', color: 'sky', description: 'Verified skill' },
  { id: 'reputation.seller', name: 'Seller Reputation', category: 'REPUTATION', unit: 'pts', color: 'fuchsia', description: 'Marketplace seller reputation' },
  { id: 'reputation.borrower', name: 'Borrower Reputation', category: 'REPUTATION', unit: 'pts', color: 'fuchsia', description: 'Credit-adjusted borrower reputation' },
  { id: 'bandwidth.liquidity', name: 'Liquidity Bandwidth', category: 'BANDWIDTH', unit: 'USD', color: 'lime', description: 'LP bandwidth per corridor' },
  { id: 'carbon.offset', name: 'Carbon Offset', category: 'CARBON', unit: 'kgCO2e', color: 'lime', description: 'Verified carbon offset' },
  { id: 'energy.kwh', name: 'Energy', category: 'ENERGY', unit: 'kWh', color: 'orange', description: 'Energy credits' },
  { id: 'time.compute', name: 'Compute Time', category: 'TIME', unit: 'hrs', color: 'slate', description: 'Compute hours' },
  { id: 'gpu.hours', name: 'GPU Hours', category: 'GPU', unit: 'hrs', color: 'violet', description: 'GPU compute hours' },
  { id: 'storage.mb', name: 'Storage', category: 'STORAGE', unit: 'MB-hrs', color: 'cyan', description: 'Decentralized storage' },
  { id: 'knowledge.insight', name: 'Insight', category: 'KNOWLEDGE', unit: 'insight', color: 'indigo', description: 'Derived knowledge insight' },
  { id: 'proof.settlement', name: 'Settlement Proof', category: 'PROOF', unit: 'proof', color: 'teal', description: 'Proof of settlement' },
  { id: 'receipt.payment', name: 'Payment Receipt', category: 'RECEIPT', unit: 'receipt', color: 'gray', description: 'Payment receipt' },
  { id: 'receipt.purchase', name: 'Purchase Receipt', category: 'RECEIPT', unit: 'receipt', color: 'gray', description: 'Purchase receipt' },
  { id: 'receipt.tuition', name: 'Tuition Receipt', category: 'RECEIPT', unit: 'receipt', color: 'gray', description: 'Tuition receipt' },
  { id: 'evidence.kyc', name: 'KYC Evidence', category: 'EVIDENCE', unit: 'record', color: 'purple', description: 'KYC verification evidence' },
  { id: 'evidence.compliance', name: 'Compliance Evidence', category: 'EVIDENCE', unit: 'record', color: 'purple', description: 'Compliance attestation' },
  { id: 'right.cashback', name: 'Cashback Right', category: 'RIGHT', unit: 'right', color: 'violet', description: 'Right to claim cashback' },
  { id: 'right.scholarship', name: 'Scholarship Right', category: 'RIGHT', unit: 'right', color: 'violet', description: 'Scholarship entitlement' },
  { id: 'right.voucher', name: 'Voucher Right', category: 'RIGHT', unit: 'right', color: 'violet', description: 'Voucher entitlement' },
  { id: 'debt.loan', name: 'Loan', category: 'DEBT', unit: 'USD', color: 'rose', description: 'Loan principal' },
  { id: 'insurance.policy', name: 'Insurance Policy', category: 'INSURANCE', unit: 'policy', color: 'cyan', description: 'Insurance policy' },
  { id: 'inference.text', name: 'Text Inference', category: 'INFERENCE', unit: 'tokens', color: 'violet', description: 'AI text inference' },
  { id: 'api.call', name: 'API Call', category: 'API_CALL', unit: 'call', color: 'sky', description: 'External API call' },
  { id: 'reservation.bandwidth', name: 'Bandwidth Reservation', category: 'RESERVATION', unit: 'slot', color: 'amber', description: 'Reserved bandwidth' },
];

// ── Capabilities — THE primitive ─────────────────────────────────────────────
const SEED_CAPABILITIES: Capability[] = [
  { id: 'cap.verify_identity', name: 'Verify Identity', description: 'KYC identity verification. Produces a verified identity credential + KYC evidence.', category: 'identity', produces: ['credential.identity', 'evidence.kyc'], requires: [], minTrust: 80, typicalLatencyMs: 1800, universal: false, createdAt: ago(30 * DAY) },
  { id: 'cap.settle_payment', name: 'Settle Payment', description: 'Settle a payment atomically. Produces a payment receipt + settlement proof.', category: 'finance', produces: ['receipt.payment', 'proof.settlement'], requires: ['currency.usd'], minTrust: 90, typicalLatencyMs: 320, universal: false, createdAt: ago(30 * DAY) },
  { id: 'cap.issue_education_credit', name: 'Issue Education Credit', description: 'Issue education credits for completed coursework. Produces enrollment credential + tuition receipt.', category: 'education', produces: ['credential.enrollment', 'receipt.tuition'], requires: ['receipt.payment', 'credential.identity'], minTrust: 75, typicalLatencyMs: 600, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.award_scholarship', name: 'Award Scholarship', description: 'Award a merit or need-based scholarship. Produces a scholarship right.', category: 'education', produces: ['right.scholarship'], requires: ['credential.identity'], minTrust: 85, typicalLatencyMs: 3600, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.issue_voucher', name: 'Issue Voucher', description: 'Issue a government or institutional voucher. Produces a voucher right.', category: 'government', produces: ['right.voucher'], requires: ['credential.identity'], minTrust: 85, typicalLatencyMs: 900, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.originate_loan', name: 'Originate Loan', description: 'Originate an undercollateralized loan. Produces a loan + updates borrower reputation.', category: 'finance', produces: ['debt.loan', 'reputation.borrower'], requires: ['credential.identity', 'reputation.seller'], minTrust: 80, typicalLatencyMs: 2400, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.process_sale', name: 'Process Sale', description: 'Process a marketplace sale. Produces a purchase receipt + cashback right.', category: 'marketplace', produces: ['receipt.purchase', 'right.cashback', 'reputation.seller'], requires: ['credential.identity', 'receipt.payment'], minTrust: 75, typicalLatencyMs: 540, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.offset_carbon', name: 'Offset Carbon', description: 'Offset the carbon footprint of a transaction. Produces carbon offsets.', category: 'environment', produces: ['carbon.offset'], requires: ['receipt.purchase', 'receipt.payment'], minTrust: 60, typicalLatencyMs: 110, universal: true, createdAt: ago(28 * DAY) },
  { id: 'cap.issue_insurance', name: 'Issue Insurance', description: 'Issue a parametric insurance policy. Produces an insurance policy.', category: 'insurance', produces: ['insurance.policy'], requires: ['credential.identity', 'receipt.purchase'], minTrust: 80, typicalLatencyMs: 900, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.verify_skill', name: 'Verify Skill', description: 'Verify + credential an employment skill. Produces a skill credential.', category: 'employment', produces: ['credential.skill'], requires: ['credential.enrollment'], minTrust: 75, typicalLatencyMs: 1500, universal: false, createdAt: ago(28 * DAY) },
  { id: 'cap.attest_compliance', name: 'Attest Compliance', description: 'Attest regulatory compliance. Produces compliance evidence.', category: 'compliance', produces: ['evidence.compliance'], requires: ['evidence.kyc'], minTrust: 90, typicalLatencyMs: 220, universal: false, createdAt: ago(28 * DAY) },
  // AI capabilities — universal, anyone (any AI model) can provide
  { id: 'cap.summarize', name: 'Summarize', description: 'Summarize text. An AI capability — any LLM can provide it.', category: 'ai', produces: ['knowledge.insight'], requires: [], minTrust: 50, typicalLatencyMs: 800, universal: true, createdAt: ago(20 * DAY) },
  { id: 'cap.translate', name: 'Translate', description: 'Translate text between languages. An AI capability.', category: 'ai', produces: ['knowledge.insight'], requires: [], minTrust: 50, typicalLatencyMs: 600, universal: true, createdAt: ago(20 * DAY) },
  { id: 'cap.detect_fraud', name: 'Detect Fraud', description: 'Detect fraud in a transaction. An AI capability.', category: 'ai', produces: ['knowledge.insight'], requires: ['receipt.payment'], minTrust: 70, typicalLatencyMs: 90, universal: true, createdAt: ago(20 * DAY) },
  { id: 'cap.run_inference', name: 'Run Inference', description: 'Run an AI model inference. Produces inference output.', category: 'ai', produces: ['inference.text'], requires: [], minTrust: 50, typicalLatencyMs: 200, universal: true, createdAt: ago(20 * DAY) },
  // Infrastructure capabilities — universal
  { id: 'cap.provide_storage', name: 'Provide Storage', description: 'Store data. Any storage provider (AWS, IPFS, a hard drive) can provide this.', category: 'infrastructure', produces: ['storage.mb'], requires: [], minTrust: 60, typicalLatencyMs: 45, universal: true, createdAt: ago(20 * DAY) },
  { id: 'cap.provide_gpu', name: 'Provide GPU', description: 'Provide GPU compute. Any GPU owner can provide this.', category: 'infrastructure', produces: ['gpu.hours'], requires: [], minTrust: 60, typicalLatencyMs: 100, universal: true, createdAt: ago(20 * DAY) },
  { id: 'cap.allocate_bandwidth', name: 'Allocate Bandwidth', description: 'Allocate LP liquidity bandwidth for a corridor.', category: 'finance', produces: ['bandwidth.liquidity', 'reservation.bandwidth'], requires: ['proof.settlement'], minTrust: 80, typicalLatencyMs: 80, universal: false, createdAt: ago(28 * DAY) },
];

// ── Heterogeneous providers — the key innovation ─────────────────────────────
// Organizations, AI models, humans, APIs, banks, government, blockchain, IoT
interface SeedProvider {
  id: string; name: string; kind: ProviderKind; description: string;
  trustScore: number; reputation: number; revenue: number; costs: number;
  invocations: number; successfulInvocations: number; failedInvocations: number;
  reliabilityScore: number; reliabilityTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  jurisdictions: string[]; carbonPerInvocation: number;
  offers: ProviderOffer[];
}
const SEED_PROVIDERS: SeedProvider[] = [
  // ── Organizations ──
  { id: 'org.identity_auth', name: 'Identity Authority', kind: 'ORGANIZATION', description: 'Autonomous identity verification organization.', trustScore: 96, reputation: 94, revenue: 42000, costs: 8400, invocations: 210000, successfulInvocations: 209100, failedInvocations: 900, reliabilityScore: 95, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE', 'TG', 'EU', 'US'], carbonPerInvocation: 0.02, offers: [{ capabilityId: 'cap.verify_identity', pricePerInvocation: 0.20, latencyMs: 1800, slaSuccessRate: 0.999, capacity: 1000, region: 'global' }] },
  { id: 'org.treasury', name: 'Treasury Corp', kind: 'ORGANIZATION', description: 'The economic backbone — settles payments.', trustScore: 98, reputation: 97, revenue: 480000, costs: 96000, invocations: 4800000, successfulInvocations: 4799500, failedInvocations: 500, reliabilityScore: 99, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE', 'TG', 'EU', 'US'], carbonPerInvocation: 0.01, offers: [{ capabilityId: 'cap.settle_payment', pricePerInvocation: 0.001, latencyMs: 320, slaSuccessRate: 0.9999, capacity: 10000, region: 'global' }, { capabilityId: 'cap.allocate_bandwidth', pricePerInvocation: 0.50, latencyMs: 80, slaSuccessRate: 0.999, capacity: 500, region: 'global' }] },
  { id: 'org.education', name: 'University of Ghana', kind: 'ORGANIZATION', description: 'Accredited university — issues education credits + enrollment credentials.', trustScore: 87, reputation: 88, revenue: 52000, costs: 14000, invocations: 32000, successfulInvocations: 31900, failedInvocations: 100, reliabilityScore: 88, reliabilityTrend: 'IMPROVING', jurisdictions: ['GH', 'NG', 'KE'], carbonPerInvocation: 0.05, offers: [{ capabilityId: 'cap.issue_education_credit', pricePerInvocation: 1.50, latencyMs: 600, slaSuccessRate: 0.999, capacity: 100, region: 'GH' }] },
  { id: 'org.education2', name: 'Accra Training Institute', kind: 'ORGANIZATION', description: 'Vocational training organization — competing education provider.', trustScore: 82, reputation: 80, revenue: 18000, costs: 5000, invocations: 8500, successfulInvocations: 8400, failedInvocations: 100, reliabilityScore: 84, reliabilityTrend: 'IMPROVING', jurisdictions: ['GH'], carbonPerInvocation: 0.04, offers: [{ capabilityId: 'cap.issue_education_credit', pricePerInvocation: 1.20, latencyMs: 450, slaSuccessRate: 0.99, capacity: 50, region: 'GH' }] },
  { id: 'org.marketplace', name: 'Marketplace Inc', kind: 'ORGANIZATION', description: 'Peer-to-peer merchant marketplace.', trustScore: 91, reputation: 89, revenue: 220000, costs: 68000, invocations: 880000, successfulInvocations: 877000, failedInvocations: 3000, reliabilityScore: 90, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE', 'TG'], carbonPerInvocation: 0.03, offers: [{ capabilityId: 'cap.process_sale', pricePerInvocation: 0.01, latencyMs: 540, slaSuccessRate: 0.997, capacity: 5000, region: 'global' }] },
  { id: 'org.lending', name: 'Micro-Bank Ltd', kind: 'ORGANIZATION', description: 'Undercollateralized lending.', trustScore: 84, reputation: 82, revenue: 86000, costs: 22000, invocations: 14000, successfulInvocations: 13800, failedInvocations: 200, reliabilityScore: 85, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG'], carbonPerInvocation: 0.04, offers: [{ capabilityId: 'cap.originate_loan', pricePerInvocation: 25, latencyMs: 2400, slaSuccessRate: 0.99, capacity: 100, region: 'GH' }] },
  { id: 'org.scholarship', name: 'Scholarship Foundation', kind: 'ORGANIZATION', description: 'Merit + need-based scholarships.', trustScore: 92, reputation: 90, revenue: 0, costs: 380000, invocations: 4800, successfulInvocations: 4800, failedInvocations: 0, reliabilityScore: 96, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE'], carbonPerInvocation: 0.01, offers: [{ capabilityId: 'cap.award_scholarship', pricePerInvocation: 0, latencyMs: 3600, slaSuccessRate: 1.0, capacity: 50, region: 'global' }] },
  { id: 'org.carbon', name: 'Carbon Exchange', kind: 'ORGANIZATION', description: 'Verified carbon offset exchange.', trustScore: 73, reputation: 75, revenue: 9000, costs: 2400, invocations: 180000, successfulInvocations: 180000, failedInvocations: 0, reliabilityScore: 92, reliabilityTrend: 'IMPROVING', jurisdictions: ['EU'], carbonPerInvocation: -0.5, offers: [{ capabilityId: 'cap.offset_carbon', pricePerInvocation: 0.05, latencyMs: 110, slaSuccessRate: 1.0, capacity: 10000, region: 'global' }] },
  { id: 'org.compliance', name: 'Compliance Authority', kind: 'ORGANIZATION', description: 'Regulatory compliance + licensing.', trustScore: 94, reputation: 92, revenue: 24000, costs: 5000, invocations: 48000, successfulInvocations: 48000, failedInvocations: 0, reliabilityScore: 97, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE', 'TG'], carbonPerInvocation: 0.01, offers: [{ capabilityId: 'cap.attest_compliance', pricePerInvocation: 0.50, latencyMs: 220, slaSuccessRate: 1.0, capacity: 1000, region: 'global' }] },
  { id: 'org.employment', name: 'Employment Network', kind: 'ORGANIZATION', description: 'Verified employment + skill credentialing.', trustScore: 78, reputation: 79, revenue: 22000, costs: 6000, invocations: 4200, successfulInvocations: 4200, failedInvocations: 0, reliabilityScore: 86, reliabilityTrend: 'IMPROVING', jurisdictions: ['GH', 'NG'], carbonPerInvocation: 0.02, offers: [{ capabilityId: 'cap.verify_skill', pricePerInvocation: 5, latencyMs: 1500, slaSuccessRate: 1.0, capacity: 200, region: 'GH' }] },

  // ── AI Models (heterogeneous provider kind) ──
  { id: 'ai.claude', name: 'Claude 3.5 Sonnet', kind: 'AI_MODEL', description: 'Anthropic Claude — excels at summarization + analysis.', trustScore: 88, reputation: 85, revenue: 36000, costs: 14000, invocations: 8200000, successfulInvocations: 8190000, failedInvocations: 10000, reliabilityScore: 91, reliabilityTrend: 'IMPROVING', jurisdictions: [], carbonPerInvocation: 0.08, offers: [{ capabilityId: 'cap.summarize', pricePerInvocation: 0.003, latencyMs: 1200, slaSuccessRate: 0.999, capacity: 10000, region: 'global' }, { capabilityId: 'cap.translate', pricePerInvocation: 0.002, latencyMs: 800, slaSuccessRate: 0.999, capacity: 10000, region: 'global' }, { capabilityId: 'cap.detect_fraud', pricePerInvocation: 0.001, latencyMs: 60, slaSuccessRate: 0.999, capacity: 50000, region: 'global' }, { capabilityId: 'cap.run_inference', pricePerInvocation: 0.002, latencyMs: 200, slaSuccessRate: 0.9995, capacity: 20000, region: 'global' }] },
  { id: 'ai.gpt4', name: 'GPT-4o', kind: 'AI_MODEL', description: 'OpenAI GPT-4o — strong general-purpose inference.', trustScore: 86, reputation: 84, revenue: 42000, costs: 18000, invocations: 9100000, successfulInvocations: 9090000, failedInvocations: 10000, reliabilityScore: 89, reliabilityTrend: 'STABLE', jurisdictions: [], carbonPerInvocation: 0.07, offers: [{ capabilityId: 'cap.summarize', pricePerInvocation: 0.005, latencyMs: 900, slaSuccessRate: 0.998, capacity: 10000, region: 'global' }, { capabilityId: 'cap.translate', pricePerInvocation: 0.003, latencyMs: 700, slaSuccessRate: 0.998, capacity: 10000, region: 'global' }, { capabilityId: 'cap.run_inference', pricePerInvocation: 0.003, latencyMs: 180, slaSuccessRate: 0.999, capacity: 20000, region: 'global' }] },
  { id: 'ai.gemini', name: 'Gemini 1.5 Pro', kind: 'AI_MODEL', description: 'Google Gemini — long-context inference.', trustScore: 84, reputation: 82, revenue: 28000, costs: 12000, invocations: 6400000, successfulInvocations: 6390000, failedInvocations: 10000, reliabilityScore: 87, reliabilityTrend: 'IMPROVING', jurisdictions: [], carbonPerInvocation: 0.06, offers: [{ capabilityId: 'cap.summarize', pricePerInvocation: 0.001, latencyMs: 1500, slaSuccessRate: 0.997, capacity: 8000, region: 'global' }, { capabilityId: 'cap.translate', pricePerInvocation: 0.001, latencyMs: 1000, slaSuccessRate: 0.997, capacity: 8000, region: 'global' }] },

  // ── APIs (heterogeneous provider kind) ──
  { id: 'api.stripe', name: 'Stripe', kind: 'API', description: 'Card payment settlement API.', trustScore: 95, reputation: 96, revenue: 0, costs: 0, invocations: 2400000, successfulInvocations: 2399760, failedInvocations: 240, reliabilityScore: 98, reliabilityTrend: 'STABLE', jurisdictions: ['US', 'EU'], carbonPerInvocation: 0.005, offers: [{ capabilityId: 'cap.settle_payment', pricePerInvocation: 0.029, latencyMs: 500, slaSuccessRate: 0.9999, capacity: 50000, region: 'global' }] },
  { id: 'api.aws_s3', name: 'AWS S3', kind: 'API', description: 'Amazon S3 object storage.', trustScore: 96, reputation: 97, revenue: 0, costs: 0, invocations: 48000000, successfulInvocations: 47999000, failedInvocations: 1000, reliabilityScore: 99, reliabilityTrend: 'STABLE', jurisdictions: [], carbonPerInvocation: 0.001, offers: [{ capabilityId: 'cap.provide_storage', pricePerInvocation: 0.0003, latencyMs: 45, slaSuccessRate: 0.9999, capacity: 1000000, region: 'global' }] },
  { id: 'api.ipfs', name: 'IPFS', kind: 'API', description: 'InterPlanetary File System — decentralized storage.', trustScore: 78, reputation: 76, revenue: 0, costs: 0, invocations: 8200000, successfulInvocations: 8180000, failedInvocations: 20000, reliabilityScore: 84, reliabilityTrend: 'STABLE', jurisdictions: [], carbonPerInvocation: 0.002, offers: [{ capabilityId: 'cap.provide_storage', pricePerInvocation: 0.0001, latencyMs: 200, slaSuccessRate: 0.997, capacity: 500000, region: 'global' }] },

  // ── Humans (heterogeneous provider kind) ──
  { id: 'human.translator_1', name: 'Ama Mensah (Translator)', kind: 'HUMAN', description: 'Professional EN→TW translator. Higher quality than AI, slower + costlier.', trustScore: 90, reputation: 88, revenue: 12000, costs: 0, invocations: 3200, successfulInvocations: 3200, failedInvocations: 0, reliabilityScore: 95, reliabilityTrend: 'STABLE', jurisdictions: ['GH'], carbonPerInvocation: 0, offers: [{ capabilityId: 'cap.translate', pricePerInvocation: 0.15, latencyMs: 3600000, slaSuccessRate: 1.0, capacity: 10, region: 'GH', notes: 'Human-quality EN→Twi translation' }] },
  { id: 'human.translator_2', name: 'Kwame Owusu (Translator)', kind: 'HUMAN', description: 'Professional EN→FR translator.', trustScore: 88, reputation: 85, revenue: 14000, costs: 0, invocations: 4100, successfulInvocations: 4090, failedInvocations: 10, reliabilityScore: 93, reliabilityTrend: 'IMPROVING', jurisdictions: ['GH', 'NG'], carbonPerInvocation: 0, offers: [{ capabilityId: 'cap.translate', pricePerInvocation: 0.12, latencyMs: 1800000, slaSuccessRate: 0.998, capacity: 15, region: 'GH', notes: 'Human-quality EN→French translation' }] },
  { id: 'human.reviewer', name: 'Sara Lee (Reviewer)', kind: 'HUMAN', description: 'Expert human reviewer for high-stakes summaries.', trustScore: 92, reputation: 90, revenue: 18000, costs: 0, invocations: 1800, successfulInvocations: 1800, failedInvocations: 0, reliabilityScore: 97, reliabilityTrend: 'STABLE', jurisdictions: ['US', 'EU'], carbonPerInvocation: 0, offers: [{ capabilityId: 'cap.summarize', pricePerInvocation: 0.50, latencyMs: 7200000, slaSuccessRate: 1.0, capacity: 5, region: 'global', notes: 'Human expert summary review' }] },

  // ── Bank (heterogeneous provider kind) ──
  { id: 'bank.ecobank', name: 'Ecobank', kind: 'BANK', description: 'Pan-African bank — settles payments via bank rails.', trustScore: 89, reputation: 87, revenue: 0, costs: 0, invocations: 1800000, successfulInvocations: 1799100, failedInvocations: 900, reliabilityScore: 92, reliabilityTrend: 'STABLE', jurisdictions: ['GH', 'NG', 'KE', 'TG'], carbonPerInvocation: 0.01, offers: [{ capabilityId: 'cap.settle_payment', pricePerInvocation: 0.015, latencyMs: 800, slaSuccessRate: 0.9995, capacity: 5000, region: 'GH' }] },

  // ── Government (heterogeneous provider kind) ──
  { id: 'gov.ghana_education', name: 'Ghana Education Service', kind: 'GOVERNMENT', description: 'Government education voucher issuer.', trustScore: 95, reputation: 90, revenue: 0, costs: 0, invocations: 2400, successfulInvocations: 2400, failedInvocations: 0, reliabilityScore: 98, reliabilityTrend: 'STABLE', jurisdictions: ['GH'], carbonPerInvocation: 0.001, offers: [{ capabilityId: 'cap.issue_voucher', pricePerInvocation: 0, latencyMs: 900, slaSuccessRate: 1.0, capacity: 500, region: 'GH' }] },

  // ── Blockchain (heterogeneous provider kind) ──
  { id: 'chain.ethereum', name: 'Ethereum', kind: 'BLOCKCHAIN', description: 'Ethereum L1 — settles payments on-chain.', trustScore: 92, reputation: 90, revenue: 0, costs: 0, invocations: 9200000, successfulInvocations: 9199000, failedInvocations: 1000, reliabilityScore: 96, reliabilityTrend: 'STABLE', jurisdictions: [], carbonPerInvocation: 0.15, offers: [{ capabilityId: 'cap.settle_payment', pricePerInvocation: 0.50, latencyMs: 12000, slaSuccessRate: 0.9999, capacity: 1000, region: 'global' }] },

  // ── GPU providers (for the AI inference chain) ──
  { id: 'org.gpu_cluster', name: 'GPU Cluster GH', kind: 'ORGANIZATION', description: 'Local GPU cluster for AI training.', trustScore: 80, reputation: 78, revenue: 14000, costs: 8000, invocations: 12000, successfulInvocations: 11900, failedInvocations: 100, reliabilityScore: 84, reliabilityTrend: 'IMPROVING', jurisdictions: ['GH'], carbonPerInvocation: 0.25, offers: [{ capabilityId: 'cap.provide_gpu', pricePerInvocation: 0.012, latencyMs: 100, slaSuccessRate: 0.99, capacity: 100, region: 'GH' }] },
];

// ── Goals ──
const SEED_GOALS: Goal[] = [
  { id: 'goal.enroll', name: 'Enroll student', description: 'Enroll a student in an accredited course. The planner discovers capabilities: verify identity → settle payment → issue education credit. It picks providers per capability — identity from Identity Authority, settlement from Treasury/Stripe/Ecobank/Ethereum, education from University of Ghana or Accra Training Institute.', category: 'education', targetAsset: 'credential.enrollment', inputs: [{ assetId: 'currency.usd', amount: 2000 }, { assetId: 'credential.identity', amount: 1 }], constraints: { budget: 50, minTrust: 80, jurisdiction: 'GH' }, createdAt: ago(20 * DAY) },
  { id: 'goal.summarize_doc', name: 'Summarize document', description: 'Summarize a document. The planner discovers the summarize capability + picks the best provider: Claude (fast, $0.003), GPT-4o ($0.005), Gemini ($0.001, slower), or a human reviewer ($0.50, highest quality). Heterogeneous providers compete on the same capability.', category: 'ai', targetAsset: 'knowledge.insight', inputs: [], constraints: { budget: 0.01, minTrust: 70 }, createdAt: ago(15 * DAY) },
  { id: 'goal.translate', name: 'Translate text', description: 'Translate text. The planner chooses between AI models (Claude/GPT/Gemini, $0.001–0.003, milliseconds) and human translators (Ama/Kwame, $0.12–0.15, minutes-to-hours). The choice depends on constraints: budget, deadline, required quality.', category: 'ai', targetAsset: 'knowledge.insight', inputs: [], constraints: { budget: 0.20, minTrust: 75 }, createdAt: ago(15 * DAY) },
  { id: 'goal.purchase', name: 'Purchase goods', description: 'Buy goods on the marketplace. Planner chains: verify identity → settle payment → process sale → offset carbon (opportunistic) → detect fraud (opportunistic).', category: 'marketplace', targetAsset: 'receipt.purchase', inputs: [{ assetId: 'currency.usd', amount: 150 }, { assetId: 'credential.identity', amount: 1 }], constraints: { budget: 5, minTrust: 75 }, createdAt: ago(15 * DAY) },
  { id: 'goal.store_data', name: 'Store data', description: 'Store data durably. Planner picks between AWS S3 ($0.0003, 99.99% SLA) and IPFS ($0.0001, 99.7% SLA). Universal capability — any storage provider can provide it.', category: 'infrastructure', targetAsset: 'storage.mb', inputs: [], constraints: { budget: 0.001, minTrust: 60 }, createdAt: ago(15 * DAY) },
  { id: 'goal.settle', name: 'Settle payment', description: 'Settle a payment. Planner picks between Treasury ($0.001, 320ms), Stripe ($0.029, 500ms), Ecobank ($0.015, 800ms), and Ethereum ($0.50, 12000ms). Heterogeneous providers (organization, API, bank, blockchain) compete.', category: 'finance', targetAsset: 'receipt.payment', inputs: [{ assetId: 'currency.usd', amount: 500 }], constraints: { budget: 1, minTrust: 90 }, createdAt: ago(15 * DAY) },
];

/** Pre-seed economic memory so the learning loop has data from first use. */
function seedMemory() {
  const records: EconomicMemoryRecord[] = [
    { id: uid('mem'), goalId: 'goal.enroll', goalName: 'Enroll student', proofId: uid('proof'), capabilities: ['cap.verify_identity', 'cap.settle_payment', 'cap.issue_education_credit'], providers: ['org.identity_auth', 'org.treasury', 'org.education'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 20 }, outcome: 'SUCCESS', totalCost: 1.70, totalLatencyMs: 2720, trustScore: 94, carbon: 0.08, customerSatisfaction: 92, executedAt: ago(2 * HOUR), durationMs: 2720 },
    { id: uid('mem'), goalId: 'goal.enroll', goalName: 'Enroll student', proofId: uid('proof'), capabilities: ['cap.verify_identity', 'cap.settle_payment', 'cap.issue_education_credit'], providers: ['org.identity_auth', 'org.treasury', 'org.education2'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 20 }, outcome: 'SUCCESS', totalCost: 1.40, totalLatencyMs: 2570, trustScore: 89, carbon: 0.07, customerSatisfaction: 88, executedAt: ago(5 * HOUR), durationMs: 2570 },
    { id: uid('mem'), goalId: 'goal.enroll', goalName: 'Enroll student', proofId: uid('proof'), capabilities: ['cap.verify_identity', 'cap.settle_payment', 'cap.issue_education_credit'], providers: ['org.identity_auth', 'api.stripe', 'org.education'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'evening', seasonality: 'peak', riskLevel: 30 }, outcome: 'PARTIAL', failureReason: 'Stripe settlement delayed', totalCost: 31.70, totalLatencyMs: 2900, trustScore: 91, carbon: 0.09, customerSatisfaction: 72, executedAt: ago(1 * DAY), durationMs: 2900 },
    { id: uid('mem'), goalId: 'goal.summarize_doc', goalName: 'Summarize document', proofId: uid('proof'), capabilities: ['cap.summarize'], providers: ['ai.claude'], context: { timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 10 }, outcome: 'SUCCESS', totalCost: 0.003, totalLatencyMs: 1200, trustScore: 88, carbon: 0.08, customerSatisfaction: 91, executedAt: ago(1 * HOUR), durationMs: 1200 },
    { id: uid('mem'), goalId: 'goal.summarize_doc', goalName: 'Summarize document', proofId: uid('proof'), capabilities: ['cap.summarize'], providers: ['ai.gpt4'], context: { timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 10 }, outcome: 'SUCCESS', totalCost: 0.005, totalLatencyMs: 900, trustScore: 86, carbon: 0.07, customerSatisfaction: 89, executedAt: ago(3 * HOUR), durationMs: 900 },
    { id: uid('mem'), goalId: 'goal.summarize_doc', goalName: 'Summarize document', proofId: uid('proof'), capabilities: ['cap.summarize'], providers: ['ai.gemini'], context: { timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 10 }, outcome: 'SUCCESS', totalCost: 0.001, totalLatencyMs: 1500, trustScore: 84, carbon: 0.06, customerSatisfaction: 85, executedAt: ago(6 * HOUR), durationMs: 1500 },
    { id: uid('mem'), goalId: 'goal.summarize_doc', goalName: 'Summarize document', proofId: uid('proof'), capabilities: ['cap.summarize'], providers: ['human.reviewer'], context: { timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 5 }, outcome: 'SUCCESS', totalCost: 0.50, totalLatencyMs: 7200000, trustScore: 92, carbon: 0, customerSatisfaction: 98, executedAt: ago(1 * DAY), durationMs: 7200000 },
    { id: uid('mem'), goalId: 'goal.translate', goalName: 'Translate text', proofId: uid('proof'), capabilities: ['cap.translate'], providers: ['ai.claude'], context: { timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 10 }, outcome: 'SUCCESS', totalCost: 0.002, totalLatencyMs: 800, trustScore: 88, carbon: 0.08, customerSatisfaction: 87, executedAt: ago(2 * HOUR), durationMs: 800 },
    { id: uid('mem'), goalId: 'goal.translate', goalName: 'Translate text', proofId: uid('proof'), capabilities: ['cap.translate'], providers: ['human.translator_1'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 5 }, outcome: 'SUCCESS', totalCost: 0.15, totalLatencyMs: 3600000, trustScore: 90, carbon: 0, customerSatisfaction: 97, executedAt: ago(8 * HOUR), durationMs: 3600000 },
    { id: uid('mem'), goalId: 'goal.translate', goalName: 'Translate text', proofId: uid('proof'), capabilities: ['cap.translate'], providers: ['human.translator_2'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 5 }, outcome: 'SUCCESS', totalCost: 0.12, totalLatencyMs: 1800000, trustScore: 88, carbon: 0, customerSatisfaction: 95, executedAt: ago(12 * HOUR), durationMs: 1800000 },
    { id: uid('mem'), goalId: 'goal.purchase', goalName: 'Purchase goods', proofId: uid('proof'), capabilities: ['cap.verify_identity', 'cap.settle_payment', 'cap.process_sale', 'cap.offset_carbon', 'cap.detect_fraud'], providers: ['org.identity_auth', 'org.treasury', 'org.marketplace', 'org.carbon', 'ai.claude'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'evening', seasonality: 'peak', riskLevel: 40 }, outcome: 'SUCCESS', totalCost: 1.56, totalLatencyMs: 1060, trustScore: 89, carbon: 0.04, customerSatisfaction: 88, executedAt: ago(3 * HOUR), durationMs: 1060 },
    { id: uid('mem'), goalId: 'goal.store_data', goalName: 'Store data', proofId: uid('proof'), capabilities: ['cap.provide_storage'], providers: ['api.aws_s3'], context: { timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 5 }, outcome: 'SUCCESS', totalCost: 0.0003, totalLatencyMs: 45, trustScore: 96, carbon: 0.001, customerSatisfaction: 93, executedAt: ago(4 * HOUR), durationMs: 45 },
    { id: uid('mem'), goalId: 'goal.store_data', goalName: 'Store data', proofId: uid('proof'), capabilities: ['cap.provide_storage'], providers: ['api.ipfs'], context: { timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 10 }, outcome: 'SUCCESS', totalCost: 0.0001, totalLatencyMs: 200, trustScore: 78, carbon: 0.002, customerSatisfaction: 82, executedAt: ago(10 * HOUR), durationMs: 200 },
    { id: uid('mem'), goalId: 'goal.settle', goalName: 'Settle payment', proofId: uid('proof'), capabilities: ['cap.settle_payment'], providers: ['org.treasury'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 20 }, outcome: 'SUCCESS', totalCost: 0.001, totalLatencyMs: 320, trustScore: 98, carbon: 0.01, customerSatisfaction: 94, executedAt: ago(1 * HOUR), durationMs: 320 },
    { id: uid('mem'), goalId: 'goal.settle', goalName: 'Settle payment', proofId: uid('proof'), capabilities: ['cap.settle_payment'], providers: ['api.stripe'], context: { jurisdiction: 'US', region: 'global', timeOfDay: 'afternoon', seasonality: 'off-peak', riskLevel: 15 }, outcome: 'SUCCESS', totalCost: 0.029, totalLatencyMs: 500, trustScore: 95, carbon: 0.005, customerSatisfaction: 90, executedAt: ago(5 * HOUR), durationMs: 500 },
    { id: uid('mem'), goalId: 'goal.settle', goalName: 'Settle payment', proofId: uid('proof'), capabilities: ['cap.settle_payment'], providers: ['bank.ecobank'], context: { jurisdiction: 'GH', region: 'GH', timeOfDay: 'morning', seasonality: 'off-peak', riskLevel: 20 }, outcome: 'SUCCESS', totalCost: 0.015, totalLatencyMs: 800, trustScore: 89, carbon: 0.01, customerSatisfaction: 86, executedAt: ago(1 * DAY), durationMs: 800 },
    { id: uid('mem'), goalId: 'goal.settle', goalName: 'Settle payment', proofId: uid('proof'), capabilities: ['cap.settle_payment'], providers: ['chain.ethereum'], context: { timeOfDay: 'night', seasonality: 'off-peak', riskLevel: 30 }, outcome: 'SUCCESS', totalCost: 0.50, totalLatencyMs: 12000, trustScore: 92, carbon: 0.15, customerSatisfaction: 78, executedAt: ago(2 * DAY), durationMs: 12000 },
  ];
  for (const r of records) platformStore.memory.push(r);
  // Compute initial learning scores from memory
  recomputeLearningScores();
}

/** Recompute learned provider scores from memory. Called after every execution. */
export function recomputeLearningScores() {
  const scores = new Map<string, ProviderLearningScore>();
  for (const m of platformStore.memory) {
    for (let i = 0; i < m.providers.length; i++) {
      const pid = m.providers[i];
      const cid = m.capabilities[i] ?? m.capabilities[0];
      const key = `${pid}::${cid}`;
      let s = scores.get(key);
      if (!s) {
        const provider = platformStore.providers.get(pid);
        s = { providerId: pid, providerName: provider?.name ?? pid, capabilityId: cid, totalExecutions: 0, successRate: 0, avgCost: 0, avgLatencyMs: 0, avgSatisfaction: 0, learnedScore: 50, trend: 'STABLE' };
        scores.set(key, s);
      }
      s.totalExecutions++;
      const success = m.outcome === 'SUCCESS' ? 1 : 0;
      s.successRate = (s.successRate * (s.totalExecutions - 1) + success * 100) / s.totalExecutions;
      s.avgCost = (s.avgCost * (s.totalExecutions - 1) + m.totalCost) / s.totalExecutions;
      s.avgLatencyMs = (s.avgLatencyMs * (s.totalExecutions - 1) + m.totalLatencyMs) / s.totalExecutions;
      if (m.customerSatisfaction !== undefined) {
        s.avgSatisfaction = (s.avgSatisfaction * (s.totalExecutions - 1) + m.customerSatisfaction) / s.totalExecutions;
      }
    }
  }
  // Compute learnedScore + trend
  for (const s of scores.values()) {
    s.learnedScore = Math.round((s.successRate * 0.4 + s.avgSatisfaction * 0.3 + Math.min(100, Math.max(0, 100 - s.avgCost * 10)) * 0.3));
    // trend: compare recent vs older (simplified)
    s.trend = s.successRate >= 90 ? 'IMPROVING' : s.successRate >= 70 ? 'STABLE' : 'DECLINING';
  }
  platformStore.learningScores = scores;
}

/** Idempotent auto-seed. */
export function seedPlatform(): void {
  if (globalForPlatform.__PAYSWAP_PLATFORM_SEEDED__) return;
  globalForPlatform.__PAYSWAP_PLATFORM_SEEDED__ = true;

  for (const a of SEED_ASSET_TYPES) platformStore.assetTypes.set(a.id, a);
  for (const c of SEED_CAPABILITIES) platformStore.capabilities.set(c.id, c);
  for (const p of SEED_PROVIDERS) {
    platformStore.providers.set(p.id, {
      id: p.id, name: p.name, kind: p.kind, status: 'ACTIVE', description: p.description,
      offers: p.offers, trustScore: p.trustScore, reputation: p.reputation,
      revenue: p.revenue, costs: p.costs, invocations: p.invocations,
      successfulInvocations: p.successfulInvocations, failedInvocations: p.failedInvocations,
      reliabilityScore: p.reliabilityScore, reliabilityTrend: p.reliabilityTrend,
      jurisdictions: p.jurisdictions, carbonPerInvocation: p.carbonPerInvocation,
      registeredAt: ago(28 * DAY),
    });
  }
  for (const g of SEED_GOALS) platformStore.goals.set(g.id, g);
  seedMemory();
}
seedPlatform();

// Re-export types
export type {
  Capability, CapabilityProvider, ProviderKind, ProviderOffer, ProviderStatus,
  AssetType, AssetTypeCategory,
  Goal, AssetBinding, ConstraintBundle,
  EconomicProof, VerificationResult, InvariantCheck,
  EconomicMemoryRecord, ProviderLearningScore,
  UnifiedGraph, GraphNode, GraphEdge,
  PlatformOverview,
} from './types';
