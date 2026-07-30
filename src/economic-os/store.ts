/**
 * Economic Operating System — Central Store.
 *
 * Process-wide singleton on globalThis (survives Next.js hot-reload), mirroring
 * the pattern from src/economic/store.ts, src/claims/store.ts, src/lp/settlement-store.ts.
 *
 * Holds: asset registry, actor registry (autonomous businesses w/ P&L),
 * capability marketplace, intent catalog, compiled graphs, settlement history.
 */

import { uid } from '@/runtime/types';
import type {
  EconomicAsset, EconomicAssetType, AssetHolding,
  EconomicActor, ActorStatus, CapabilityAdvertisement, ActorPolicy,
  Intent, AssetBinding, IntentConstraints,
  CompositionGraph, CompositionNode, CompositionEdge, CompositionGraphStatus,
  PolicyViolation, SettlementExecution, SettlementStep,
  EconomicOSOverview,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicOSStore {
  assets: Map<string, EconomicAsset>;
  holdings: Map<string, AssetHolding>;          // key = `${assetId}::${holderId}`
  actors: Map<string, EconomicActor>;
  capabilities: Map<string, CapabilityAdvertisement>;
  intents: Map<string, Intent>;
  graphs: CompositionGraph[];
  settlements: SettlementExecution[];
}

function createStore(): EconomicOSStore {
  return {
    assets: new Map(), holdings: new Map(), actors: new Map(),
    capabilities: new Map(), intents: new Map(),
    graphs: [], settlements: [],
  };
}

const globalForEOS = globalThis as unknown as {
  __PAYSWAP_ECONOMIC_OS_STORE__?: EconomicOSStore;
  __PAYSWAP_ECONOMIC_OS_SEEDED__?: boolean;
};

export const eosStore: EconomicOSStore =
  globalForEOS.__PAYSWAP_ECONOMIC_OS_STORE__ ?? createStore();
if (!globalForEOS.__PAYSWAP_ECONOMIC_OS_STORE__) {
  globalForEOS.__PAYSWAP_ECONOMIC_OS_STORE__ = eosStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const holdingKey = (assetId: string, holderId: string) => `${assetId}::${holderId}`;

/** Mutate a holding. Exported so the settlement kernel can credit/debit assets. */
export function touchHolding(assetId: string, holderId: string, holderType: AssetHolding['holderType'], holderLabel: string, delta: number, consumedDelta = 0): AssetHolding {
  const k = holdingKey(assetId, holderId);
  let h = eosStore.holdings.get(k);
  if (!h) {
    h = { assetId, holderId, holderType, holderLabel, balance: 0, consumed: 0, updatedAt: Date.now() };
    eosStore.holdings.set(k, h);
  }
  h.balance += delta;
  h.consumed += consumedDelta;
  h.updatedAt = Date.now();
  // update actor treasury if holder is an actor
  if (holderType === 'ACTOR') {
    const actor = eosStore.actors.get(holderId);
    if (actor) actor.treasury[assetId] = (actor.treasury[assetId] ?? 0) + delta;
  }
  return h;
}

function countHolders(assetId: string): number {
  let n = 0;
  for (const h of eosStore.holdings.values()) if (h.assetId === assetId && h.balance > 0) n++;
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE OBJECT — public API
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicOSService {
  // ── Assets ──
  listAssets(filter?: { type?: EconomicAssetType }): EconomicAsset[];
  getAsset(id: string): EconomicAsset | undefined;
  listHoldings(filter?: { assetId?: string; holderId?: string }): AssetHolding[];

  // ── Actors ──
  listActors(): EconomicActor[];
  getActor(id: string): EconomicActor | undefined;

  // ── Capabilities ──
  listCapabilities(filter?: { produces?: string; region?: string }): CapabilityAdvertisement[];

  // ── Intents ──
  listIntents(): Intent[];
  getIntent(id: string): Intent | undefined;

  // ── Graphs + Settlements ──
  listGraphs(limit?: number): CompositionGraph[];
  getGraph(id: string): CompositionGraph | undefined;
  listSettlements(limit?: number): SettlementExecution[];

  // ── Overview ──
  overview(): EconomicOSOverview;
}

export const economicOS: EconomicOSService = {
  listAssets(filter) {
    let rows = Array.from(eosStore.assets.values());
    if (filter?.type) rows = rows.filter((a) => a.type === filter.type);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  },
  getAsset(id) { return eosStore.assets.get(id); },
  listHoldings(filter) {
    let rows = Array.from(eosStore.holdings.values());
    if (filter?.assetId) rows = rows.filter((h) => h.assetId === filter.assetId);
    if (filter?.holderId) rows = rows.filter((h) => h.holderId === filter.holderId);
    return rows.sort((a, b) => b.balance - a.balance);
  },
  listActors() { return Array.from(eosStore.actors.values()).sort((a, b) => b.profit - a.profit); },
  getActor(id) { return eosStore.actors.get(id); },
  listCapabilities(filter) {
    let rows = Array.from(eosStore.capabilities.values());
    if (filter?.produces) rows = rows.filter((c) => c.produces.includes(filter.produces!));
    if (filter?.region) rows = rows.filter((c) => c.region === filter.region || c.region === 'global');
    return rows.sort((a, b) => a.pricePerInvocation - b.pricePerInvocation);
  },
  listIntents() { return Array.from(eosStore.intents.values()).sort((a, b) => a.createdAt - b.createdAt); },
  getIntent(id) { return eosStore.intents.get(id); },
  listGraphs(limit) {
    const rows = eosStore.graphs;
    return limit ? rows.slice(0, limit) : rows;
  },
  getGraph(id) { return eosStore.graphs.find((g) => g.id === id); },
  listSettlements(limit) {
    const rows = eosStore.settlements;
    return limit ? rows.slice(0, limit) : rows;
  },
  overview(): EconomicOSOverview {
    const actors = Array.from(eosStore.actors.values());
    const graphs = eosStore.graphs;
    const settlements = eosStore.settlements;
    return {
      actorCount: actors.length,
      activeActorCount: actors.filter((a) => a.status === 'ACTIVE').length,
      assetTypeCount: new Set(Array.from(eosStore.assets.values()).map((a) => a.type)).size,
      assetCount: eosStore.assets.size,
      intentCount: eosStore.intents.size,
      capabilityCount: eosStore.capabilities.size,
      compilationCount: graphs.length,
      settlementCount: settlements.length,
      settledCount: settlements.filter((s) => s.status === 'SETTLED').length,
      totalRevenue: actors.reduce((s, a) => s + a.revenue, 0),
      totalProfit: actors.reduce((s, a) => s + a.profit, 0),
      totalTreasuryValue: actors.reduce((s, a) => s + a.balanceSheetAssets, 0),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED — assets (all 14 types), actors (12 autonomous businesses w/ P&L),
// capabilities (with competing providers), intents (8), sample graphs
// ═══════════════════════════════════════════════════════════════════════════

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => Date.now() - ms;

interface SeedAsset {
  id: string; name: string; type: EconomicAssetType; issuer: string; unit: string;
  fungible: boolean; transferable: boolean; consumable: boolean; timeLimited: boolean;
  description: string; color: string;
}

// 32 assets spanning all 14 types
const SEED_ASSETS: SeedAsset[] = [
  // CURRENCY
  { id: 'currency.usd',  name: 'US Dollar',       type: 'CURRENCY',  issuer: 'treasury',  unit: 'USD',  fungible: true,  transferable: true,  consumable: true,  timeLimited: false, color: 'emerald', description: 'Fiat US Dollar.' },
  { id: 'currency.ghs',  name: 'Ghana Cedi',      type: 'CURRENCY',  issuer: 'treasury',  unit: 'GHS',  fungible: true,  transferable: true,  consumable: true,  timeLimited: false, color: 'emerald', description: 'Fiat Ghana Cedi.' },
  { id: 'currency.usdc', name: 'USD Coin',        type: 'CURRENCY',  issuer: 'treasury',  unit: 'USDC', fungible: true,  transferable: true,  consumable: true,  timeLimited: false, color: 'emerald', description: 'Stablecoin USDC.' },
  // CLAIM
  { id: 'claim.reserve_certificate', name: 'Reserve Certificate', type: 'CLAIM', issuer: 'treasury', unit: 'cert', fungible: true, transferable: true, consumable: false, timeLimited: false, color: 'teal', description: '1:1 backing certificate for fiat reserves.' },
  { id: 'claim.escrow', name: 'Escrow Claim', type: 'CLAIM', issuer: 'treasury', unit: 'claim', fungible: false, transferable: true, consumable: true, timeLimited: true, color: 'teal', description: 'A claim on funds held in escrow pending settlement.' },
  // CREDENTIAL
  { id: 'credential.verified_identity', name: 'Verified Identity', type: 'CREDENTIAL', issuer: 'identity', unit: 'cred', fungible: false, transferable: false, consumable: true, timeLimited: false, color: 'sky', description: 'Soulbound KYC-verified identity proof.' },
  { id: 'credential.skill', name: 'Verified Skill', type: 'CREDENTIAL', issuer: 'employment', unit: 'skill', fungible: false, transferable: false, consumable: false, timeLimited: false, color: 'sky', description: 'Accredited skill credential (NFT, soulbound).' },
  // RIGHT
  { id: 'right.cashback', name: 'Cashback Right', type: 'RIGHT', issuer: 'marketplace', unit: 'right', fungible: true, transferable: false, consumable: true, timeLimited: true, color: 'violet', description: 'Right to claim cashback on a settled sale.' },
  { id: 'right.discount', name: 'Discount Right', type: 'RIGHT', issuer: 'marketplace', unit: 'right', fungible: true, transferable: false, consumable: true, timeLimited: true, color: 'violet', description: 'Right to apply a discount at checkout.' },
  // RESERVATION
  { id: 'reservation.inventory', name: 'Inventory Reservation', type: 'RESERVATION', issuer: 'marketplace', unit: 'slot', fungible: false, transferable: false, consumable: true, timeLimited: true, color: 'amber', description: 'A held inventory slot pending purchase.' },
  { id: 'reservation.bandwidth', name: 'Bandwidth Reservation', type: 'RESERVATION', issuer: 'bandwidth', unit: 'bps', fungible: true, transferable: true, consumable: true, timeLimited: true, color: 'amber', description: 'Reserved LP liquidity bandwidth for a corridor.' },
  // DEBT
  { id: 'debt.loan', name: 'Loan Principal', type: 'DEBT', issuer: 'lending', unit: 'USD', fungible: true, transferable: true, consumable: false, timeLimited: true, color: 'rose', description: 'Outstanding loan principal owed.' },
  { id: 'debt.collateral', name: 'Collateral Position', type: 'DEBT', issuer: 'lending', unit: 'USD', fungible: true, transferable: false, consumable: false, timeLimited: true, color: 'rose', description: 'Locked collateral backing a loan.' },
  // EQUITY
  { id: 'equity.lp_stake', name: 'LP Stake', type: 'EQUITY', issuer: 'treasury', unit: 'shares', fungible: true, transferable: true, consumable: false, timeLimited: false, color: 'indigo', description: 'Equity stake in the LP pool.' },
  // INSURANCE
  { id: 'insurance.policy', name: 'Insurance Policy', type: 'INSURANCE', issuer: 'insurance', unit: 'policy', fungible: false, transferable: false, consumable: false, timeLimited: true, color: 'cyan', description: 'Active parametric insurance policy NFT.' },
  // REPUTATION
  { id: 'reputation.seller', name: 'Seller Reputation', type: 'REPUTATION', issuer: 'marketplace', unit: 'pts', fungible: true, transferable: false, consumable: false, timeLimited: false, color: 'fuchsia', description: 'Accumulated marketplace seller reputation score.' },
  { id: 'reputation.borrower', name: 'Borrower Reputation', type: 'REPUTATION', issuer: 'lending', unit: 'pts', fungible: true, transferable: false, consumable: false, timeLimited: false, color: 'fuchsia', description: 'Credit-adjusted borrower reputation score.' },
  // CAPABILITY
  { id: 'capability.inference', name: 'AI Inference Credit', type: 'CAPABILITY', issuer: 'ai', unit: 'credits', fungible: true, transferable: true, consumable: true, timeLimited: true, color: 'orange', description: 'Prepaid AI model inference credits.' },
  { id: 'capability.storage', name: 'Storage Credit', type: 'CAPABILITY', issuer: 'storage', unit: 'MB-hrs', fungible: true, transferable: true, consumable: true, timeLimited: true, color: 'orange', description: 'Decentralized storage credits.' },
  { id: 'capability.compute', name: 'Compute Credit', type: 'CAPABILITY', issuer: 'compute', unit: 'CPU-hrs', fungible: true, transferable: true, consumable: true, timeLimited: true, color: 'orange', description: 'Compute cycles.' },
  // BANDWIDTH
  { id: 'bandwidth.liquidity', name: 'Liquidity Bandwidth', type: 'BANDWIDTH', issuer: 'bandwidth', unit: 'USD', fungible: true, transferable: true, consumable: true, timeLimited: true, color: 'lime', description: 'LP liquidity bandwidth allocation per corridor.' },
  // LICENSE
  { id: 'license.msb', name: 'MSB License', type: 'LICENSE', issuer: 'compliance', unit: 'license', fungible: false, transferable: false, consumable: false, timeLimited: true, color: 'slate', description: 'Money Services Business operating license.' },
  // EVIDENCE
  { id: 'evidence.kyc', name: 'KYC Evidence', type: 'EVIDENCE', issuer: 'identity', unit: 'record', fungible: false, transferable: false, consumable: false, timeLimited: false, color: 'purple', description: 'Auditable KYC verification evidence.' },
  { id: 'evidence.compliance', name: 'Compliance Evidence', type: 'EVIDENCE', issuer: 'compliance', unit: 'record', fungible: false, transferable: false, consumable: false, timeLimited: false, color: 'purple', description: 'Regulatory compliance attestation.' },
  { id: 'evidence.tax', name: 'Tax Receipt Evidence', type: 'EVIDENCE', issuer: 'treasury', unit: 'record', fungible: false, transferable: false, consumable: false, timeLimited: false, color: 'purple', description: 'Tax filing evidence.' },
  // RECEIPT
  { id: 'receipt.payment', name: 'Payment Receipt', type: 'RECEIPT', issuer: 'treasury', unit: 'receipt', fungible: false, transferable: true, consumable: false, timeLimited: false, color: 'gray', description: 'Proof of settled payment.' },
  { id: 'receipt.tuition', name: 'Tuition Receipt', type: 'RECEIPT', issuer: 'education', unit: 'receipt', fungible: false, transferable: true, consumable: false, timeLimited: false, color: 'gray', description: 'Proof of tuition payment + credit issuance.' },
  { id: 'receipt.purchase', name: 'Purchase Receipt', type: 'RECEIPT', issuer: 'marketplace', unit: 'receipt', fungible: false, transferable: true, consumable: false, timeLimited: false, color: 'gray', description: 'Marketplace purchase receipt.' },
  // Additional domain assets
  { id: 'education.credit', name: 'Education Credit', type: 'CREDENTIAL', issuer: 'education', unit: 'credits', fungible: true, transferable: false, consumable: true, timeLimited: false, color: 'sky', description: 'Credit for completed accredited coursework.' },
  { id: 'carbon.offset', name: 'Carbon Offset', type: 'RIGHT', issuer: 'carbon', unit: 'kgCO2e', fungible: true, transferable: true, consumable: false, timeLimited: false, color: 'lime', description: 'Verified carbon offset credit.' },
  { id: 'reward.points', name: 'Reward Points', type: 'RIGHT', issuer: 'rewards', unit: 'pts', fungible: true, transferable: false, consumable: true, timeLimited: true, color: 'violet', description: 'Customer loyalty reward points.' },
];

interface SeedActor {
  id: string; name: string; version: string; category: string; description: string;
  reputation: number; trustScore: number;
  produces: string[]; consumes: string[]; capabilities: string[];
  policies: Array<{ name: string; description: string; rule: string; enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL' }>;
  treasury: Record<string, number>;
  balanceSheetAssets: number; balanceSheetLiabilities: number;
  revenue: number; costs: number; invocations: number; successfulInvocations: number; failedInvocations: number; avgLatencyMs: number;
}

const SEED_ACTORS: SeedActor[] = [
  {
    id: 'identity', name: 'Identity Actor', version: '3.0.0', category: 'identity', description: 'Autonomous KYC + identity verification business. Charges $0.20 per verification. Produces verified identity credentials + KYC evidence. Foundation of the trust graph — no other actor can operate without consuming its credential.',
    reputation: 94, trustScore: 96,
    produces: ['credential.verified_identity', 'evidence.kyc'], consumes: [],
    capabilities: ['verify_identity', 'verify_passport', 'verify_address'],
    policies: [
      { name: 'Require consent', description: 'Identity verification requires explicit user consent.', rule: 'require_consent', enforcement: 'BLOCK' },
      { name: 'GDPR retention', description: 'KYC evidence retained 7 years per regulation.', rule: 'retention_7y', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 42000, 'capability.inference': 50000 },
    balanceSheetAssets: 42000, balanceSheetLiabilities: 0,
    revenue: 42000, costs: 8400, invocations: 210000, successfulInvocations: 209100, failedInvocations: 900, avgLatencyMs: 1800,
  },
  {
    id: 'treasury', name: 'Treasury Actor', version: '5.0.0', category: 'treasury', description: 'The economic backbone. Mints reserve certificates (1:1 fiat-backed), settles payments, issues payment receipts + tax evidence. Charges 0.1% settlement fee. Every payment intent routes through here.',
    reputation: 97, trustScore: 98,
    produces: ['claim.reserve_certificate', 'receipt.payment', 'evidence.tax', 'currency.usd', 'currency.ghs', 'currency.usdc', 'equity.lp_stake'],
    consumes: [],
    capabilities: ['settle_payment', 'mint_reserve', 'issue_receipt', 'collect_tax'],
    policies: [
      { name: 'Solvency floor', description: 'Reserve coverage must stay above 100%.', rule: 'min_solvency_100', enforcement: 'BLOCK' },
      { name: 'FX exposure cap', description: 'Net FX exposure capped at $5M per currency.', rule: 'max_fx_exposure_5m', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 8500000, 'currency.ghs': 12000000, 'currency.usdc': 3200000, 'claim.reserve_certificate': 23700000 },
    balanceSheetAssets: 23700000, balanceSheetLiabilities: 23700000,
    revenue: 480000, costs: 96000, invocations: 4800000, successfulInvocations: 4799500, failedInvocations: 500, avgLatencyMs: 320,
  },
  {
    id: 'marketplace', name: 'Marketplace Actor', version: '4.0.0', category: 'marketplace', description: 'Peer-to-peer merchant marketplace. 1% commission on sales. Produces purchase receipts, cashback rights, inventory reservations, seller reputation. Consumes verified identity + payment confirmation.',
    reputation: 89, trustScore: 91,
    produces: ['receipt.purchase', 'right.cashback', 'reservation.inventory', 'reputation.seller'],
    consumes: ['credential.verified_identity', 'receipt.payment'],
    capabilities: ['list_item', 'process_sale', 'reserve_inventory', 'issue_cashback'],
    policies: [
      { name: 'KYC required', description: 'Sellers must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Inventory cap', description: 'Max $50K inventory per merchant.', rule: 'max_inventory_50k', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 180000, 'right.cashback': 12000 },
    balanceSheetAssets: 180000, balanceSheetLiabilities: 42000,
    revenue: 220000, costs: 68000, invocations: 880000, successfulInvocations: 877000, failedInvocations: 3000, avgLatencyMs: 540,
  },
  {
    id: 'lending', name: 'Lending Actor', version: '2.5.0', category: 'lending', description: 'Undercollateralized lending backed by reputation. 8% APR. Produces loan principal, collateral positions, borrower reputation. Consumes verified identity + seller reputation + reserve certificates.',
    reputation: 82, trustScore: 84,
    produces: ['debt.loan', 'debt.collateral', 'reputation.borrower'],
    consumes: ['credential.verified_identity', 'reputation.seller', 'claim.reserve_certificate'],
    capabilities: ['originate_loan', 'price_risk', 'adjust_credit'],
    policies: [
      { name: 'KYC required', description: 'Borrowers must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Max exposure', description: 'Max $50K unsecured exposure per borrower.', rule: 'max_exposure_50k', enforcement: 'BLOCK' },
      { name: 'Collateral floor', description: 'Min 120% collateral coverage.', rule: 'min_collateral_120', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 920000, 'debt.loan': 480000, 'debt.collateral': 580000 },
    balanceSheetAssets: 920000, balanceSheetLiabilities: 480000,
    revenue: 86000, costs: 22000, invocations: 14000, successfulInvocations: 13800, failedInvocations: 200, avgLatencyMs: 2400,
  },
  {
    id: 'ai', name: 'AI Director Actor', version: '2.0.0', category: 'ai', description: 'Autonomous economic intelligence. Sells inference credits at $0.002/invocation. Detects fraud, optimizes routing, scores risk. Consumes payment/purchase receipts to learn.',
    reputation: 85, trustScore: 83,
    produces: ['capability.inference'],
    consumes: ['receipt.payment', 'receipt.purchase'],
    capabilities: ['detect_fraud', 'route_payment', 'score_risk', 'run_inference'],
    policies: [
      { name: 'No PII training', description: 'Never trains on PII fields.', rule: 'no_pii_training', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 24000, 'capability.inference': 8000000 },
    balanceSheetAssets: 24000, balanceSheetLiabilities: 0,
    revenue: 36000, costs: 14000, invocations: 18000000, successfulInvocations: 17991000, failedInvocations: 9000, avgLatencyMs: 90,
  },
  {
    id: 'storage', name: 'Storage Actor', version: '2.0.0', category: 'storage', description: 'Decentralized document + receipt archive. $0.0003 per document-month. Consumes purchase/payment receipts to auto-archive. The AI actor buys storage from here when it needs to persist models.',
    reputation: 78, trustScore: 79,
    produces: ['capability.storage'],
    consumes: ['receipt.payment', 'receipt.purchase', 'receipt.tuition'],
    capabilities: ['archive', 'retrieve', 'pin'],
    policies: [
      { name: 'Geo-replication', description: 'All evidence replicated 3x geographically.', rule: 'replication_3x', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 12000, 'capability.storage': 480000000 },
    balanceSheetAssets: 12000, balanceSheetLiabilities: 0,
    revenue: 18000, costs: 4000, invocations: 6200000, successfulInvocations: 6198000, failedInvocations: 2000, avgLatencyMs: 45,
  },
  {
    id: 'compute', name: 'Compute Actor', version: '1.0.0', category: 'compute', description: 'Distributed compute cycles for AI training + analytics. $0.012/CPU-hr. The AI actor buys compute here when running heavy inferences.',
    reputation: 74, trustScore: 72,
    produces: ['capability.compute'],
    consumes: ['capability.inference'],
    capabilities: ['run_job', 'schedule'],
    policies: [
      { name: 'Max job 4h', description: 'No job exceeds 4 hours.', rule: 'max_job_4h', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 8000, 'capability.compute': 9600000 },
    balanceSheetAssets: 8000, balanceSheetLiabilities: 0,
    revenue: 9600, costs: 3200, invocations: 480000, successfulInvocations: 479000, failedInvocations: 1000, avgLatencyMs: 120,
  },
  {
    id: 'bandwidth', name: 'Bandwidth Actor', version: '1.5.0', category: 'bandwidth', description: 'LP liquidity bandwidth allocation per corridor. Sells bandwidth reservations. Expands capacity as treasury mints reserves. Consumes reserve certificates.',
    reputation: 84, trustScore: 82,
    produces: ['bandwidth.liquidity', 'reservation.bandwidth'],
    consumes: ['claim.reserve_certificate'],
    capabilities: ['allocate_bandwidth', 'rebalance'],
    policies: [
      { name: 'Corridor cap', description: 'Max $2M per corridor per LP.', rule: 'max_corridor_2m', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 64000, 'bandwidth.liquidity': 4200000, 'reservation.bandwidth': 880000 },
    balanceSheetAssets: 64000, balanceSheetLiabilities: 880000,
    revenue: 72000, costs: 18000, invocations: 240000, successfulInvocations: 239000, failedInvocations: 1000, avgLatencyMs: 80,
  },
  {
    id: 'rewards', name: 'Rewards Actor', version: '2.7.0', category: 'rewards', description: 'Customer loyalty engine. Produces reward points. Consumes cashback rights + purchase receipts. Pays out points on every settled sale — the canonical opportunistic actor.',
    reputation: 86, trustScore: 85,
    produces: ['reward.points'],
    consumes: ['right.cashback', 'receipt.purchase', 'receipt.payment'],
    capabilities: ['issue_points', 'redeem', 'tier_upgrade'],
    policies: [
      { name: 'Expiry 12mo', description: 'Points expire after 12 months.', rule: 'expiry_12mo', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 28000, 'reward.points': 84000000 },
    balanceSheetAssets: 28000, balanceSheetLiabilities: 84000,
    revenue: 32000, costs: 9000, invocations: 720000, successfulInvocations: 719500, failedInvocations: 500, avgLatencyMs: 60,
  },
  {
    id: 'insurance', name: 'Insurance Actor', version: '1.2.0', category: 'insurance', description: 'On-chain parametric insurance. Produces insurance policies. Consumes verified identity + purchase receipts (to offer policy upsells). 4% premium.',
    reputation: 80, trustScore: 81,
    produces: ['insurance.policy'],
    consumes: ['credential.verified_identity', 'receipt.purchase'],
    capabilities: ['issue_policy', 'price_premium', 'payout'],
    policies: [
      { name: 'KYC required', description: 'Policyholders must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Max payout 100k', description: 'Max $100K payout per policy.', rule: 'max_payout_100k', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 320000, 'insurance.policy': 2400 },
    balanceSheetAssets: 320000, balanceSheetLiabilities: 240000,
    revenue: 38000, costs: 11000, invocations: 2400, successfulInvocations: 2400, failedInvocations: 0, avgLatencyMs: 900,
  },
  {
    id: 'carbon', name: 'Carbon Actor', version: '1.1.0', category: 'carbon', description: 'Verified carbon offset credits. Produces carbon offsets from every purchase receipt — the canonical opportunistic actor. No identity requirement; purely reactive. $0.05 per offset.',
    reputation: 75, trustScore: 73,
    produces: ['carbon.offset'],
    consumes: ['receipt.purchase', 'receipt.payment'],
    capabilities: ['offset_footprint', 'retire_offset'],
    policies: [
      { name: 'Verra only', description: 'Only Verra-verified offsets accepted.', rule: 'verra_only', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 6000, 'carbon.offset': 840000 },
    balanceSheetAssets: 6000, balanceSheetLiabilities: 0,
    revenue: 9000, costs: 2400, invocations: 180000, successfulInvocations: 180000, failedInvocations: 0, avgLatencyMs: 110,
  },
  {
    id: 'education', name: 'Education Actor', version: '1.0.0', category: 'education', description: 'Accredited learning + credentialing. Produces education credits + tuition receipts. Consumes payment receipts (tuition). Demonstrates cross-domain composition: payment → education → employment → credit.',
    reputation: 88, trustScore: 87,
    produces: ['education.credit', 'receipt.tuition'],
    consumes: ['receipt.payment', 'credential.verified_identity'],
    capabilities: ['accredit', 'issue_credit', 'issue_tuition_receipt'],
    policies: [
      { name: 'Accreditation', description: 'Only accredited institutions.', rule: 'accredited_only', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 44000, 'education.credit': 96000 },
    balanceSheetAssets: 44000, balanceSheetLiabilities: 0,
    revenue: 52000, costs: 14000, invocations: 32000, successfulInvocations: 31900, failedInvocations: 100, avgLatencyMs: 600,
  },
  {
    id: 'employment', name: 'Employment Actor', version: '1.0.0', category: 'employment', description: 'Verified employment + skill credentialing. Produces verified skill credentials. Consumes education credits. Completes the tuition → skill → credit cascade. The lending actor subscribes to skills to raise credit limits.',
    reputation: 79, trustScore: 78,
    produces: ['credential.skill'],
    consumes: ['education.credit'],
    capabilities: ['verify_skill', 'issue_credential'],
    policies: [
      { name: 'Employer attestation', description: 'Skills require employer attestation.', rule: 'employer_attestation', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 18000, 'credential.skill': 4200 },
    balanceSheetAssets: 18000, balanceSheetLiabilities: 0,
    revenue: 22000, costs: 6000, invocations: 4200, successfulInvocations: 4200, failedInvocations: 0, avgLatencyMs: 1500,
  },
  {
    id: 'compliance', name: 'Compliance Actor', version: '2.0.0', category: 'compliance', description: 'Regulatory compliance + licensing. Produces MSB licenses + compliance evidence. Consumes KYC evidence. The policy engine consults compliance to validate every composition.',
    reputation: 92, trustScore: 94,
    produces: ['license.msb', 'evidence.compliance'],
    consumes: ['evidence.kyc'],
    capabilities: ['audit', 'issue_license', 'attest_compliance'],
    policies: [
      { name: 'Jurisdiction check', description: 'Composition must satisfy destination jurisdiction.', rule: 'jurisdiction_check', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 16000, 'license.msb': 12 },
    balanceSheetAssets: 16000, balanceSheetLiabilities: 0,
    revenue: 24000, costs: 5000, invocations: 48000, successfulInvocations: 48000, failedInvocations: 0, avgLatencyMs: 220,
  },
];

// Capability marketplace — competing providers where applicable
interface SeedCapability {
  actorId: string; name: string; description: string; produces: string[]; consumes: string[];
  pricePerInvocation: number; priceAsset?: string; latencyMs: number; slaSuccessRate: number;
  trustScore: number; region: string; regulatoryApproved: string[];
}
const SEED_CAPABILITIES: SeedCapability[] = [
  { actorId: 'identity',    name: 'verify_identity',  description: 'Full KYC identity verification',     produces: ['credential.verified_identity'], consumes: [], pricePerInvocation: 0.20, latencyMs: 1800, slaSuccessRate: 0.999, trustScore: 96, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG', 'EU', 'US'] },
  { actorId: 'identity',    name: 'verify_passport',  description: 'Passport-only verification (cheaper)', produces: ['credential.verified_identity'], consumes: [], pricePerInvocation: 0.08, latencyMs: 600, slaSuccessRate: 0.95, trustScore: 88, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG'] },
  { actorId: 'identity',    name: 'verify_address',   description: 'Address verification (utility bill)', produces: ['credential.verified_identity'], consumes: [], pricePerInvocation: 0.05, latencyMs: 2400, slaSuccessRate: 0.92, trustScore: 78, region: 'global', regulatoryApproved: ['GH', 'NG'] },
  { actorId: 'treasury',    name: 'settle_payment',   description: 'Settle a payment atomically',         produces: ['receipt.payment', 'evidence.tax'], consumes: ['currency.usd'], pricePerInvocation: 0.001, latencyMs: 320, slaSuccessRate: 0.9999, trustScore: 98, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG', 'EU', 'US'] },
  { actorId: 'treasury',    name: 'mint_reserve',     description: 'Mint 1:1 reserve certificate',        produces: ['claim.reserve_certificate'], consumes: ['currency.usd'], pricePerInvocation: 0.0001, latencyMs: 150, slaSuccessRate: 1.0, trustScore: 99, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG', 'EU', 'US'] },
  { actorId: 'marketplace', name: 'process_sale',     description: 'Process a marketplace sale',          produces: ['receipt.purchase', 'right.cashback', 'reservation.inventory'], consumes: ['credential.verified_identity', 'receipt.payment'], pricePerInvocation: 0.01, latencyMs: 540, slaSuccessRate: 0.997, trustScore: 91, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG'] },
  { actorId: 'lending',     name: 'originate_loan',   description: 'Originate an undercollateralized loan',produces: ['debt.loan', 'debt.collateral', 'reputation.borrower'], consumes: ['credential.verified_identity', 'reputation.seller', 'claim.reserve_certificate'], pricePerInvocation: 25, latencyMs: 2400, slaSuccessRate: 0.99, trustScore: 84, region: 'global', regulatoryApproved: ['GH', 'NG'] },
  { actorId: 'ai',          name: 'run_inference',    description: 'Run an AI model inference',           produces: [], consumes: ['capability.inference'], pricePerInvocation: 0.002, latencyMs: 90, slaSuccessRate: 0.9995, trustScore: 83, region: 'global', regulatoryApproved: [] },
  { actorId: 'ai',          name: 'detect_fraud',     description: 'Fraud detection on a transaction',    produces: [], consumes: ['receipt.payment'], pricePerInvocation: 0.001, latencyMs: 60, slaSuccessRate: 0.999, trustScore: 85, region: 'global', regulatoryApproved: [] },
  { actorId: 'storage',     name: 'archive',          description: 'Archive a document permanently',      produces: [], consumes: ['receipt.payment', 'receipt.purchase'], pricePerInvocation: 0.0003, latencyMs: 45, slaSuccessRate: 0.9999, trustScore: 79, region: 'global', regulatoryApproved: [] },
  { actorId: 'bandwidth',   name: 'allocate_bandwidth',description:'Allocate LP bandwidth for a corridor',produces: ['bandwidth.liquidity', 'reservation.bandwidth'], consumes: ['claim.reserve_certificate'], pricePerInvocation: 0.50, latencyMs: 80, slaSuccessRate: 0.999, trustScore: 82, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG'] },
  { actorId: 'rewards',     name: 'issue_points',     description: 'Issue reward points for a purchase',  produces: ['reward.points'], consumes: ['right.cashback', 'receipt.purchase'], pricePerInvocation: 0.0001, latencyMs: 60, slaSuccessRate: 0.9999, trustScore: 85, region: 'global', regulatoryApproved: [] },
  { actorId: 'insurance',   name: 'issue_policy',     description: 'Issue a parametric insurance policy', produces: ['insurance.policy'], consumes: ['credential.verified_identity', 'receipt.purchase'], pricePerInvocation: 12, latencyMs: 900, slaSuccessRate: 1.0, trustScore: 81, region: 'global', regulatoryApproved: ['GH', 'NG'] },
  { actorId: 'carbon',      name: 'offset_footprint', description: 'Offset carbon footprint of a purchase',produces: ['carbon.offset'], consumes: ['receipt.purchase'], pricePerInvocation: 0.05, latencyMs: 110, slaSuccessRate: 1.0, trustScore: 73, region: 'global', regulatoryApproved: ['EU'] },
  { actorId: 'education',   name: 'issue_credit',     description: 'Issue education credit for coursework',produces: ['education.credit', 'receipt.tuition'], consumes: ['receipt.payment', 'credential.verified_identity'], pricePerInvocation: 1.50, latencyMs: 600, slaSuccessRate: 0.999, trustScore: 87, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE'] },
  { actorId: 'employment',  name: 'verify_skill',     description: 'Verify + credential an employment skill',produces: ['credential.skill'], consumes: ['education.credit'], pricePerInvocation: 5, latencyMs: 1500, slaSuccessRate: 1.0, trustScore: 78, region: 'global', regulatoryApproved: ['GH', 'NG'] },
  { actorId: 'compliance',  name: 'issue_license',    description: 'Issue an MSB operating license',      produces: ['license.msb', 'evidence.compliance'], consumes: ['evidence.kyc'], pricePerInvocation: 500, latencyMs: 86400000, slaSuccessRate: 1.0, trustScore: 94, region: 'global', regulatoryApproved: ['GH', 'NG', 'KE', 'TG'] },
];

// Intent catalog — what users can express
interface SeedIntent {
  id: string; name: string; description: string; goal: string;
  inputs: AssetBinding[]; desiredOutputs?: string[]; constraints?: IntentConstraints;
  category: string;
}
const SEED_INTENTS: SeedIntent[] = [
  {
    id: 'intent-pay-tuition', name: 'Pay Tuition', category: 'education',
    description: 'Pay tuition for an accredited course. The compiler discovers: verify identity → settle payment → mint tuition receipt → issue education credits → update employment profile → increase reputation → issue tax receipt → emit compliance evidence → archive proof. No pipeline written — the compiler found it.',
    goal: 'education.credit',
    inputs: [{ assetId: 'currency.usd', amount: 2000 }, { assetId: 'credential.verified_identity', amount: 1 }],
    desiredOutputs: ['receipt.tuition', 'evidence.tax', 'credential.skill', 'evidence.compliance'],
    constraints: { maxCost: 50, maxLatencyMs: 30000, minTrust: 80, region: 'GH', preferCheapest: true },
  },
  {
    id: 'intent-marketplace-purchase', name: 'Marketplace Purchase', category: 'marketplace',
    description: 'Buy an item on the marketplace. The compiler discovers: verify identity → settle payment → process sale → reserve inventory → issue cashback → issue reward points → offset carbon → detect fraud → archive receipt. One purchase, eight actors, zero coupling.',
    goal: 'receipt.purchase',
    inputs: [{ assetId: 'currency.usd', amount: 150 }, { assetId: 'credential.verified_identity', amount: 1 }],
    desiredOutputs: ['right.cashback', 'reward.points', 'carbon.offset', 'reputation.seller'],
    constraints: { maxCost: 5, maxLatencyMs: 5000, minTrust: 75, region: 'GH' },
  },
  {
    id: 'intent-originate-loan', name: 'Originate Loan', category: 'lending',
    description: 'Borrow against seller reputation. The compiler discovers: verify identity → fetch seller reputation → check reserve certificates → originate loan → lock collateral → update borrower reputation → compliance audit. Demonstrates reputation as collateral.',
    goal: 'debt.loan',
    inputs: [{ assetId: 'credential.verified_identity', amount: 1 }, { assetId: 'reputation.seller', amount: 1 }],
    desiredOutputs: ['reputation.borrower', 'evidence.compliance'],
    constraints: { maxCost: 100, maxLatencyMs: 10000, minTrust: 85, region: 'GH' },
  },
  {
    id: 'intent-issue-insurance', name: 'Issue Insurance Policy', category: 'insurance',
    description: 'Issue a parametric insurance policy after a marketplace purchase. The compiler discovers: verify identity → fetch purchase receipt → price premium → issue policy → compliance attestation.',
    goal: 'insurance.policy',
    inputs: [{ assetId: 'credential.verified_identity', amount: 1 }, { assetId: 'receipt.purchase', amount: 1 }],
    desiredOutputs: ['evidence.compliance'],
    constraints: { maxCost: 30, maxLatencyMs: 5000, minTrust: 80, region: 'GH' },
  },
  {
    id: 'intent-verify-identity', name: 'Verify Identity', category: 'identity',
    description: 'Standalone KYC verification. The compiler discovers the cheapest verified-identity provider (3 competing providers: full KYC $0.20, passport-only $0.08, address-only $0.05) and chooses based on constraints. Demonstrates the capability marketplace.',
    goal: 'credential.verified_identity',
    inputs: [],
    desiredOutputs: ['evidence.kyc'],
    constraints: { maxCost: 1, maxLatencyMs: 3000, minTrust: 85, region: 'GH', preferCheapest: true },
  },
  {
    id: 'intent-settle-payment', name: 'Settle Payment', category: 'payment',
    description: 'Settle a raw payment. The compiler discovers: settle payment → mint reserve certificate → issue payment receipt → collect tax evidence → expand LP bandwidth → AI fraud detection → archive. The canonical payment cascade.',
    goal: 'receipt.payment',
    inputs: [{ assetId: 'currency.usd', amount: 500 }],
    desiredOutputs: ['claim.reserve_certificate', 'evidence.tax', 'bandwidth.liquidity'],
    constraints: { maxCost: 5, maxLatencyMs: 2000, minTrust: 90, region: 'GH' },
  },
  {
    id: 'intent-cross-border', name: 'Cross-Border Remittance', category: 'payment',
    description: 'Send money across borders. The compiler discovers: verify identity → allocate bandwidth → settle payment → mint reserve → compliance evidence → fraud detection → archive. The remittance composition.',
    goal: 'receipt.payment',
    inputs: [{ assetId: 'currency.usd', amount: 1000 }, { assetId: 'credential.verified_identity', amount: 1 }],
    desiredOutputs: ['reservation.bandwidth', 'evidence.compliance', 'claim.reserve_certificate'],
    constraints: { maxCost: 15, maxLatencyMs: 5000, minTrust: 88, region: 'GH', preferCheapest: true },
  },
  {
    id: 'intent-ai-inference', name: 'Run AI Inference', category: 'ai',
    description: 'Run an AI inference job. The compiler discovers: AI needs compute + storage → buys compute from Compute Actor → buys storage from Storage Actor → runs inference → records P&L for all three actors. Demonstrates the internal economy (actors trading with each other).',
    goal: 'capability.inference',
    inputs: [{ assetId: 'currency.usd', amount: 5 }],
    desiredOutputs: ['capability.compute', 'capability.storage'],
    constraints: { maxCost: 5, maxLatencyMs: 1000, minTrust: 70, preferCheapest: true },
  },
];

/** Idempotent auto-seed on first import. */
export function seedEconomicOS(): void {
  if (globalForEOS.__PAYSWAP_ECONOMIC_OS_SEEDED__) return;
  globalForEOS.__PAYSWAP_ECONOMIC_OS_SEEDED__ = true;

  // 1. Assets
  for (const a of SEED_ASSETS) {
    eosStore.assets.set(a.id, {
      id: a.id, name: a.name, type: a.type, issuer: a.issuer, unit: a.unit,
      fungible: a.fungible, transferable: a.transferable, consumable: a.consumable, timeLimited: a.timeLimited,
      description: a.description, color: a.color,
      totalSupply: 0, holderCount: 0, createdAt: ago(30 * DAY),
    });
  }

  // 2. Actors
  for (const a of SEED_ACTORS) {
    const policies: ActorPolicy[] = a.policies.map((p, i) => ({ id: `${a.id}-policy-${i}`, ...p }));
    eosStore.actors.set(a.id, {
      id: a.id, name: a.name, version: a.version, status: 'ACTIVE',
      category: a.category, description: a.description,
      contracts: { produces: a.produces, consumes: a.consumes, capabilities: a.capabilities, policies },
      treasury: { ...a.treasury },
      reputation: a.reputation, trustScore: a.trustScore,
      revenue: a.revenue, costs: a.costs, profit: a.revenue - a.costs,
      balanceSheetAssets: a.balanceSheetAssets, balanceSheetLiabilities: a.balanceSheetLiabilities,
      invocations: a.invocations, successfulInvocations: a.successfulInvocations,
      failedInvocations: a.failedInvocations, avgLatencyMs: a.avgLatencyMs,
      registeredAt: ago(28 * DAY),
    });
  }

  // 3. Capabilities
  for (const c of SEED_CAPABILITIES) {
    const id = `${c.actorId}:${c.name}`;
    eosStore.capabilities.set(id, {
      id, actorId: c.actorId, name: c.name, description: c.description,
      produces: c.produces, consumes: c.consumes,
      pricePerInvocation: c.pricePerInvocation, priceAsset: c.priceAsset,
      latencyMs: c.latencyMs, slaSuccessRate: c.slaSuccessRate, trustScore: c.trustScore,
      region: c.region, regulatoryApproved: c.regulatoryApproved,
    });
  }

  // 4. Intents
  for (const i of SEED_INTENTS) {
    eosStore.intents.set(i.id, {
      id: i.id, name: i.name, description: i.description, goal: i.goal,
      inputs: i.inputs, desiredOutputs: i.desiredOutputs, constraints: i.constraints,
      category: i.category, createdAt: ago(20 * DAY),
    });
  }

  // 5. Initial holdings (so balance sheets have data)
  const initialHoldings: Array<[string, string, AssetHolding['holderType'], string, number]> = [
    ['currency.usd', 'treasury', 'ACTOR', 'Treasury Actor', 8500000],
    ['currency.ghs', 'treasury', 'ACTOR', 'Treasury Actor', 12000000],
    ['claim.reserve_certificate', 'treasury', 'ACTOR', 'Treasury Actor', 23700000],
    ['currency.usd', 'marketplace', 'ACTOR', 'Marketplace Actor', 180000],
    ['debt.loan', 'lending', 'ACTOR', 'Lending Actor', 480000],
    ['capability.inference', 'ai', 'ACTOR', 'AI Director Actor', 8000000],
    ['capability.storage', 'storage', 'ACTOR', 'Storage Actor', 480000000],
    ['bandwidth.liquidity', 'bandwidth', 'ACTOR', 'Bandwidth Actor', 4200000],
    ['reward.points', 'rewards', 'ACTOR', 'Rewards Actor', 84000000],
    ['carbon.offset', 'carbon', 'ACTOR', 'Carbon Actor', 840000],
    ['education.credit', 'education', 'ACTOR', 'Education Actor', 96000],
    ['credential.verified_identity', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 1],
    ['credential.verified_identity', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 1],
    ['currency.usd', 'cust_demo_001', 'CUSTOMER', 'Aba Kwesi', 3200],
    ['currency.usd', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 5400],
    ['reward.points', 'cust_demo_042', 'CUSTOMER', 'Mara Diallo', 3420],
    ['reputation.seller', 'merch_demo_001', 'MERCHANT', 'Accra Coffee Co', 240],
  ];
  for (const [assetId, holderId, holderType, holderLabel, balance] of initialHoldings) {
    const asset = eosStore.assets.get(assetId);
    if (!asset) continue;
    touchHolding(assetId, holderId, holderType, holderLabel, balance);
    asset.totalSupply += balance;
    asset.holderCount = countHolders(assetId);
  }
}
seedEconomicOS();

// Re-export types
export type {
  EconomicAsset, EconomicAssetType, AssetHolding,
  EconomicActor, ActorStatus, CapabilityAdvertisement, ActorPolicy, ActorContracts,
  Intent, AssetBinding, IntentConstraints,
  CompositionGraph, CompositionNode, CompositionEdge, CompositionGraphStatus, CompositionNodeKind, CompositionNodeStatus,
  PolicyViolation, SettlementExecution, SettlementStep,
  EconomicOSOverview,
} from './types';
