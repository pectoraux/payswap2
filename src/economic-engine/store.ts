/**
 * General-Purpose Economic Computation Engine — Central Store.
 *
 * Process-wide singleton on globalThis. Holds: organizations (autonomous
 * economic entities), goals (implementation-agnostic), proofs, and economic
 * memory (learned execution patterns).
 */

import { uid } from '@/runtime/types';
import type {
  Organization, OrganizationStatus, OrgPolicy, OrganizationObjective, GovernanceRule,
  Goal, Strategy, AssetBinding, ConstraintBundle,
  EconomicProof, ProofNode, ProofEdge, ProofStatus,
  VerificationResult, InvariantCheck,
  MemoryEntry, CooperationScore, StrategyEffectiveness, OrganizationReliability,
  EconomicEngineOverview,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicEngineStore {
  organizations: Map<string, Organization>;
  goals: Map<string, Goal>;
  proofs: EconomicProof[];
  memory: MemoryEntry[];
}

function createStore(): EconomicEngineStore {
  return { organizations: new Map(), goals: new Map(), proofs: [], memory: [] };
}

const globalForEngine = globalThis as unknown as {
  __PAYSWAP_ECONOMIC_ENGINE_STORE__?: EconomicEngineStore;
  __PAYSWAP_ECONOMIC_ENGINE_SEEDED__?: boolean;
};

export const engineStore: EconomicEngineStore =
  globalForEngine.__PAYSWAP_ECONOMIC_ENGINE_STORE__ ?? createStore();
if (!globalForEngine.__PAYSWAP_ECONOMIC_ENGINE_STORE__) {
  globalForEngine.__PAYSWAP_ECONOMIC_ENGINE_STORE__ = engineStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE OBJECT — read API. Writes happen via planner + verifier.
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicEngineService {
  listOrganizations(): Organization[];
  getOrganization(id: string): Organization | undefined;
  listGoals(): Goal[];
  getGoal(id: string): Goal | undefined;
  listProofs(limit?: number): EconomicProof[];
  getProof(id: string): EconomicProof | undefined;
  listMemory(limit?: number): MemoryEntry[];
  listCooperation(): CooperationScore[];
  listStrategyEffectiveness(): StrategyEffectiveness[];
  listOrganizationReliability(): OrganizationReliability[];
  overview(): EconomicEngineOverview;
}

export const economicEngine: EconomicEngineService = {
  listOrganizations() { return Array.from(engineStore.organizations.values()).sort((a, b) => b.profit - a.profit); },
  getOrganization(id) { return engineStore.organizations.get(id); },
  listGoals() { return Array.from(engineStore.goals.values()).sort((a, b) => a.createdAt - b.createdAt); },
  getGoal(id) { return engineStore.goals.get(id); },
  listProofs(limit) { const r = engineStore.proofs; return limit ? r.slice(0, limit) : r; },
  getProof(id) { return engineStore.proofs.find((p) => p.id === id); },
  listMemory(limit) { const r = engineStore.memory; return limit ? r.slice(0, limit) : r; },
  listCooperation() { return computeCooperation(); },
  listStrategyEffectiveness() { return computeStrategyEffectiveness(); },
  listOrganizationReliability() { return computeOrganizationReliability(); },
  overview() {
    const orgs = Array.from(engineStore.organizations.values());
    const mem = engineStore.memory;
    return {
      organizationCount: orgs.length,
      activeOrganizationCount: orgs.filter((o) => o.status === 'ACTIVE').length,
      goalCount: engineStore.goals.size,
      proofCount: engineStore.proofs.length,
      settledProofCount: engineStore.proofs.filter((p) => p.status === 'settled').length,
      memoryEntries: mem.length,
      avgSuccessRate: mem.length ? (mem.filter((m) => m.outcome === 'SUCCESS').length / mem.length) * 100 : 0,
      totalExecutions: mem.length,
      totalRevenue: orgs.reduce((s, o) => s + o.revenue, 0),
      totalProfit: orgs.reduce((s, o) => s + o.profit, 0),
      cooperationPairs: computeCooperation().length,
      strategiesUsed: new Set(mem.map((m) => m.strategy)).size,
    };
  },
};

function computeCooperation(): CooperationScore[] {
  const pairs = new Map<string, CooperationScore>();
  for (const m of engineStore.memory) {
    for (let i = 0; i < m.organizationIds.length; i++) {
      for (let j = i + 1; j < m.organizationIds.length; j++) {
        const a = m.organizationIds[i]; const b = m.organizationIds[j];
        const key = [a, b].sort().join('::');
        let s = pairs.get(key);
        if (!s) { s = { orgA: a < b ? a : b, orgB: a < b ? b : a, jointExecutions: 0, successRate: 0, avgCost: 0, avgLatencyMs: 0 }; pairs.set(key, s); }
        s.jointExecutions++;
        s.avgCost = (s.avgCost * (s.jointExecutions - 1) + m.totalCost) / s.jointExecutions;
        s.avgLatencyMs = (s.avgLatencyMs * (s.jointExecutions - 1) + m.totalLatencyMs) / s.jointExecutions;
        if (m.outcome === 'SUCCESS') s.successRate = (s.successRate * (s.jointExecutions - 1) + 100) / s.jointExecutions;
      }
    }
  }
  return Array.from(pairs.values()).sort((a, b) => b.jointExecutions - a.jointExecutions).slice(0, 20);
}

function computeStrategyEffectiveness(): StrategyEffectiveness[] {
  const byStrategy = new Map<Strategy, MemoryEntry[]>();
  for (const m of engineStore.memory) {
    if (!byStrategy.has(m.strategy)) byStrategy.set(m.strategy, []);
    byStrategy.get(m.strategy)!.push(m);
  }
  return Array.from(byStrategy.entries()).map(([strategy, entries]) => ({
    strategy,
    totalExecutions: entries.length,
    successRate: (entries.filter((e) => e.outcome === 'SUCCESS').length / entries.length) * 100,
    avgCost: entries.reduce((s, e) => s + e.totalCost, 0) / entries.length,
    avgLatencyMs: entries.reduce((s, e) => s + e.totalLatencyMs, 0) / entries.length,
    avgTrust: entries.reduce((s, e) => s + e.trustScore, 0) / entries.length,
    avgSatisfaction: entries.filter((e) => e.customerSatisfaction !== undefined).reduce((s, e) => s + (e.customerSatisfaction ?? 0), 0) / Math.max(1, entries.filter((e) => e.customerSatisfaction !== undefined).length),
  })).sort((a, b) => b.totalExecutions - a.totalExecutions);
}

function computeOrganizationReliability(): OrganizationReliability[] {
  const byOrg = new Map<string, MemoryEntry[]>();
  for (const m of engineStore.memory) {
    for (const oid of m.organizationIds) {
      if (!byOrg.has(oid)) byOrg.set(oid, []);
      byOrg.get(oid)!.push(m);
    }
  }
  return Array.from(byOrg.entries()).map(([oid, entries]) => {
    const org = engineStore.organizations.get(oid);
    const successRate = (entries.filter((e) => e.outcome === 'SUCCESS').length / entries.length) * 100;
    // trend: compare last 3 vs first 3
    const recent = entries.slice(0, 3); const older = entries.slice(-3);
    const recentSuccess = recent.filter((e) => e.outcome === 'SUCCESS').length;
    const olderSuccess = older.filter((e) => e.outcome === 'SUCCESS').length;
    return {
      organizationId: oid,
      organizationName: org?.name ?? oid,
      totalExecutions: entries.length,
      successRate,
      avgCost: entries.reduce((s, e) => s + e.totalCost, 0) / entries.length,
      avgLatencyMs: entries.reduce((s, e) => s + e.totalLatencyMs, 0) / entries.length,
      trend: (recentSuccess > olderSuccess ? 'IMPROVING' : recentSuccess < olderSuccess ? 'DECLINING' : 'STABLE') as 'IMPROVING' | 'STABLE' | 'DECLINING',
    };
  }).sort((a, b) => b.totalExecutions - a.totalExecutions);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED — organizations (autonomous w/ governance + objectives), goals
// (implementation-agnostic), and economic memory (learned patterns)
// ═══════════════════════════════════════════════════════════════════════════

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => Date.now() - ms;

interface SeedOrg {
  id: string; name: string; legalName: string; version: string; category: string; description: string;
  reputation: number; trustScore: number;
  produces: string[]; consumes: string[]; capabilities: string[]; policies: Array<{ name: string; description: string; rule: string; enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL' }>;
  treasury: Record<string, number>;
  revenue: number; costs: number; profitTarget: number;
  balanceSheetAssets: number; balanceSheetLiabilities: number;
  objectives: Array<{ description: string; type: 'MAXIMIZE_REVENUE' | 'MAXIMIZE_IMPACT' | 'MINIMIZE_RISK' | 'MAXIMIZE_TRUST' | 'GROWTH'; target: number; current: number }>;
  governance: Array<{ name: string; description: string; rule: string; type: 'CONSENT' | 'MAJORITY' | 'AUTONOMOUS' | 'SUPERVISORY' }>;
  workforceSize: number; reserveRequirement: number;
  invocations: number; successfulInvocations: number; failedInvocations: number; avgLatencyMs: number; carbonPerInvocation: number;
}

const SEED_ORGS: SeedOrg[] = [
  {
    id: 'identity', name: 'Identity Authority', legalName: 'PaySwap Identity Authority Ltd', version: '3.0.0', category: 'identity',
    description: 'Autonomous identity verification organization. Issues verified identity credentials + KYC evidence. Foundation of the trust graph. Governance: supervisory board. Objective: maximize trust.',
    reputation: 94, trustScore: 96,
    produces: ['credential.verified_identity', 'evidence.kyc'], consumes: [],
    capabilities: ['verify_identity', 'verify_passport', 'verify_address'],
    policies: [
      { name: 'Consent required', description: 'Identity verification requires explicit user consent.', rule: 'require_consent', enforcement: 'BLOCK' },
      { name: 'GDPR retention', description: 'KYC evidence retained 7 years per regulation.', rule: 'retention_7y', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 42000 }, revenue: 42000, costs: 8400, profitTarget: 50000,
    balanceSheetAssets: 42000, balanceSheetLiabilities: 0,
    objectives: [
      { description: 'Maximize trust score', type: 'MAXIMIZE_TRUST', target: 99, current: 96 },
      { description: 'Grow verification volume', type: 'GROWTH', target: 300000, current: 210000 },
    ],
    governance: [
      { name: 'Supervisory board', description: 'All policy changes require supervisory board consent.', rule: 'board_consent', type: 'SUPERVISORY' },
      { name: 'Autonomous verification', description: 'Day-to-day verifications run autonomously.', rule: 'autonomous_ops', type: 'AUTONOMOUS' },
    ],
    workforceSize: 24, reserveRequirement: 10000,
    invocations: 210000, successfulInvocations: 209100, failedInvocations: 900, avgLatencyMs: 1800, carbonPerInvocation: 0.02,
  },
  {
    id: 'treasury', name: 'Treasury Organization', legalName: 'PaySwap Treasury Corp', version: '5.0.0', category: 'treasury',
    description: 'The economic backbone. Settles payments, mints reserve certificates, issues receipts + tax evidence. Governance: autonomous within solvency floor. Objective: maximize revenue while maintaining 100% solvency.',
    reputation: 97, trustScore: 98,
    produces: ['claim.reserve_certificate', 'receipt.payment', 'evidence.tax', 'currency.usd', 'currency.ghs', 'currency.usdc'],
    consumes: [],
    capabilities: ['settle_payment', 'mint_reserve', 'issue_receipt', 'collect_tax'],
    policies: [
      { name: 'Solvency floor', description: 'Reserve coverage must stay above 100%.', rule: 'min_solvency_100', enforcement: 'BLOCK' },
      { name: 'FX exposure cap', description: 'Net FX exposure capped at $5M per currency.', rule: 'max_fx_exposure_5m', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 8500000, 'currency.ghs': 12000000, 'currency.usdc': 3200000, 'claim.reserve_certificate': 23700000 },
    revenue: 480000, costs: 96000, profitTarget: 600000,
    balanceSheetAssets: 23700000, balanceSheetLiabilities: 23700000,
    objectives: [
      { description: 'Maximize settlement revenue', type: 'MAXIMIZE_REVENUE', target: 600000, current: 480000 },
      { description: 'Maintain solvency', type: 'MINIMIZE_RISK', target: 100, current: 100 },
    ],
    governance: [
      { name: 'Autonomous settlement', description: 'Settlements under $100K run autonomously.', rule: 'autonomous_under_100k', type: 'AUTONOMOUS' },
      { name: 'Supervisory for >$100K', description: 'Settlements above $100K require supervisory consent.', rule: 'supervisory_over_100k', type: 'SUPERVISORY' },
    ],
    workforceSize: 12, reserveRequirement: 5000000,
    invocations: 4800000, successfulInvocations: 4799500, failedInvocations: 500, avgLatencyMs: 320, carbonPerInvocation: 0.01,
  },
  {
    id: 'education', name: 'Education Organization', legalName: 'PaySwap Education Academy LLC', version: '2.0.0', category: 'education',
    description: 'Autonomous accredited learning organization. Issues education credits + enrollment credentials + tuition receipts. Accepts payment, scholarships, sponsorships, vouchers, stored credits, and deferred financing. Governance: academic board.',
    reputation: 88, trustScore: 87,
    produces: ['education.credit', 'credential.enrollment', 'receipt.tuition'],
    consumes: ['receipt.payment', 'credential.verified_identity', 'right.scholarship', 'right.sponsorship', 'right.voucher'],
    capabilities: ['enroll_student', 'issue_credit', 'issue_tuition_receipt', 'issue_enrollment_credential'],
    policies: [
      { name: 'Accreditation', description: 'Only accredited institutions.', rule: 'accredited_only', enforcement: 'BLOCK' },
      { name: 'Capacity limit', description: 'Max 500 enrollments per term.', rule: 'max_capacity_500', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 44000, 'education.credit': 96000 }, revenue: 52000, costs: 14000, profitTarget: 80000,
    balanceSheetAssets: 44000, balanceSheetLiabilities: 0,
    objectives: [
      { description: 'Maximize enrollment', type: 'MAXIMIZE_IMPACT', target: 500, current: 320 },
      { description: 'Grow revenue', type: 'MAXIMIZE_REVENUE', target: 80000, current: 52000 },
    ],
    governance: [
      { name: 'Academic board', description: 'Curriculum + admissions require academic board majority.', rule: 'academic_majority', type: 'MAJORITY' },
      { name: 'Autonomous enrollment', description: 'Eligible students auto-enrolled.', rule: 'autonomous_enrollment', type: 'AUTONOMOUS' },
    ],
    workforceSize: 48, reserveRequirement: 20000,
    invocations: 32000, successfulInvocations: 31900, failedInvocations: 100, avgLatencyMs: 600, carbonPerInvocation: 0.05,
  },
  {
    id: 'marketplace', name: 'Marketplace Organization', legalName: 'PaySwap Marketplace Inc', version: '4.0.0', category: 'marketplace',
    description: 'Peer-to-peer merchant marketplace organization. 1% commission. Processes sales, issues cashback rights + purchase receipts, reserves inventory.',
    reputation: 89, trustScore: 91,
    produces: ['receipt.purchase', 'right.cashback', 'reservation.inventory', 'reputation.seller'],
    consumes: ['credential.verified_identity', 'receipt.payment'],
    capabilities: ['list_item', 'process_sale', 'reserve_inventory', 'issue_cashback'],
    policies: [
      { name: 'KYC required', description: 'Sellers must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Inventory cap', description: 'Max $50K inventory per merchant.', rule: 'max_inventory_50k', enforcement: 'WARN' },
    ],
    treasury: { 'currency.usd': 180000 }, revenue: 220000, costs: 68000, profitTarget: 250000,
    balanceSheetAssets: 180000, balanceSheetLiabilities: 42000,
    objectives: [
      { description: 'Maximize transaction volume', type: 'MAXIMIZE_REVENUE', target: 300000, current: 220000 },
      { description: 'Grow seller base', type: 'GROWTH', target: 1200, current: 880 },
    ],
    governance: [
      { name: 'Autonomous operations', description: 'All marketplace operations autonomous.', rule: 'autonomous_ops', type: 'AUTONOMOUS' },
    ],
    workforceSize: 32, reserveRequirement: 50000,
    invocations: 880000, successfulInvocations: 877000, failedInvocations: 3000, avgLatencyMs: 540, carbonPerInvocation: 0.03,
  },
  {
    id: 'lending', name: 'Micro-Bank', legalName: 'PaySwap Lending Bank Ltd', version: '2.5.0', category: 'lending',
    description: 'Autonomous micro-bank. Undercollateralized lending backed by reputation. 8% APR. Originates loans, locks collateral, adjusts credit. Provides deferred financing for goals like enrollment.',
    reputation: 82, trustScore: 84,
    produces: ['debt.loan', 'debt.collateral', 'reputation.borrower', 'right.financing'],
    consumes: ['credential.verified_identity', 'reputation.seller', 'claim.reserve_certificate'],
    capabilities: ['originate_loan', 'price_risk', 'adjust_credit', 'offer_financing'],
    policies: [
      { name: 'KYC required', description: 'Borrowers must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Max exposure', description: 'Max $50K unsecured exposure per borrower.', rule: 'max_exposure_50k', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 920000, 'debt.loan': 480000 }, revenue: 86000, costs: 22000, profitTarget: 120000,
    balanceSheetAssets: 920000, balanceSheetLiabilities: 480000,
    objectives: [
      { description: 'Maximize lending revenue', type: 'MAXIMIZE_REVENUE', target: 120000, current: 86000 },
      { description: 'Minimize default risk', type: 'MINIMIZE_RISK', target: 5, current: 3 },
    ],
    governance: [
      { name: 'Autonomous underwriting', description: 'Loans under $10K auto-approved.', rule: 'auto_under_10k', type: 'AUTONOMOUS' },
      { name: 'Supervisory for >$10K', description: 'Loans above $10K require supervisory consent.', rule: 'supervisory_over_10k', type: 'SUPERVISORY' },
    ],
    workforceSize: 18, reserveRequirement: 400000,
    invocations: 14000, successfulInvocations: 13800, failedInvocations: 200, avgLatencyMs: 2400, carbonPerInvocation: 0.04,
  },
  {
    id: 'scholarship', name: 'Scholarship Foundation', legalName: 'PaySwap Scholarship Foundation', version: '1.0.0', category: 'scholarship',
    description: 'Autonomous scholarship + grant organization. Awards merit + need-based scholarships. Issues scholarship rights redeemable at education organizations. Funding from endowment + donations.',
    reputation: 90, trustScore: 92,
    produces: ['right.scholarship', 'evidence.scholarship'],
    consumes: ['credential.verified_identity', 'currency.usd'],
    capabilities: ['award_scholarship', 'evaluate_merit', 'evaluate_need', 'issue_grant'],
    policies: [
      { name: 'Merit threshold', description: 'Scholarships require minimum merit score.', rule: 'min_merit', enforcement: 'BLOCK' },
      { name: 'Need verification', description: 'Need-based awards require income verification.', rule: 'need_verification', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 2400000, 'right.scholarship': 480 }, revenue: 0, costs: 380000, profitTarget: 0,
    balanceSheetAssets: 2400000, balanceSheetLiabilities: 0,
    objectives: [
      { description: 'Maximize scholarships awarded', type: 'MAXIMIZE_IMPACT', target: 600, current: 480 },
    ],
    governance: [
      { name: 'Board consent', description: 'All awards require board consent.', rule: 'board_consent', type: 'CONSENT' },
    ],
    workforceSize: 14, reserveRequirement: 1000000,
    invocations: 4800, successfulInvocations: 4800, failedInvocations: 0, avgLatencyMs: 3600, carbonPerInvocation: 0.01,
  },
  {
    id: 'sponsor', name: 'Sponsorship Broker', legalName: 'PaySwap Sponsorship Network Ltd', version: '1.0.0', category: 'sponsorship',
    description: 'Autonomous sponsorship broker organization. Matches employers + third parties with sponsorship opportunities. Issues sponsorship rights. 5% broker fee.',
    reputation: 80, trustScore: 79,
    produces: ['right.sponsorship'],
    consumes: ['credential.verified_identity'],
    capabilities: ['match_sponsor', 'issue_sponsorship', 'verify_sponsor'],
    policies: [
      { name: 'Sponsor verification', description: 'Sponsors must be verified.', rule: 'verify_sponsor', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 38000 }, revenue: 28000, costs: 9000, profitTarget: 40000,
    balanceSheetAssets: 38000, balanceSheetLiabilities: 0,
    objectives: [
      { description: 'Maximize sponsorship volume', type: 'MAXIMIZE_REVENUE', target: 40000, current: 28000 },
    ],
    governance: [{ name: 'Autonomous matching', description: 'Matching runs autonomously.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 8, reserveRequirement: 15000,
    invocations: 2200, successfulInvocations: 2100, failedInvocations: 100, avgLatencyMs: 1800, carbonPerInvocation: 0.02,
  },
  {
    id: 'voucher', name: 'Voucher Authority', legalName: 'PaySwap Voucher Authority', version: '1.0.0', category: 'voucher',
    description: 'Government + institutional voucher issuance organization. Issues education + healthcare + food vouchers. Funded by government contracts.',
    reputation: 85, trustScore: 88,
    produces: ['right.voucher'],
    consumes: ['credential.verified_identity'],
    capabilities: ['issue_voucher', 'verify_eligibility', 'redeem_voucher'],
    policies: [
      { name: 'Eligibility check', description: 'Vouchers require eligibility verification.', rule: 'verify_eligibility', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 890000, 'right.voucher': 2400 }, revenue: 0, costs: 120000, profitTarget: 0,
    balanceSheetAssets: 890000, balanceSheetLiabilities: 0,
    objectives: [
      { description: 'Maximize voucher distribution', type: 'MAXIMIZE_IMPACT', target: 3000, current: 2400 },
    ],
    governance: [{ name: 'Government oversight', description: 'All vouchers require government oversight.', rule: 'gov_oversight', type: 'SUPERVISORY' }],
    workforceSize: 22, reserveRequirement: 400000,
    invocations: 2400, successfulInvocations: 2400, failedInvocations: 0, avgLatencyMs: 900, carbonPerInvocation: 0.01,
  },
  {
    id: 'rewards', name: 'Rewards Organization', legalName: 'PaySwap Rewards LLC', version: '2.7.0', category: 'rewards',
    description: 'Customer loyalty engine. Issues reward points. Consumes cashback rights + purchase receipts. The canonical opportunistic organization.',
    reputation: 86, trustScore: 85,
    produces: ['reward.points'],
    consumes: ['right.cashback', 'receipt.purchase', 'receipt.payment'],
    capabilities: ['issue_points', 'redeem', 'tier_upgrade'],
    policies: [{ name: 'Expiry 12mo', description: 'Points expire after 12 months.', rule: 'expiry_12mo', enforcement: 'WARN' }],
    treasury: { 'currency.usd': 28000, 'reward.points': 84000000 }, revenue: 32000, costs: 9000, profitTarget: 40000,
    balanceSheetAssets: 28000, balanceSheetLiabilities: 84000,
    objectives: [{ description: 'Maximize engagement', type: 'MAXIMIZE_IMPACT', target: 1000000, current: 720000 }],
    governance: [{ name: 'Autonomous', description: 'All operations autonomous.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 10, reserveRequirement: 10000,
    invocations: 720000, successfulInvocations: 719500, failedInvocations: 500, avgLatencyMs: 60, carbonPerInvocation: 0.001,
  },
  {
    id: 'carbon', name: 'Carbon Exchange', legalName: 'PaySwap Carbon Exchange Ltd', version: '1.1.0', category: 'carbon',
    description: 'Autonomous carbon offset exchange. Issues + retires verified carbon offsets. Verra-only. Reacts to purchase/payment receipts.',
    reputation: 75, trustScore: 73,
    produces: ['carbon.offset'],
    consumes: ['receipt.purchase', 'receipt.payment'],
    capabilities: ['offset_footprint', 'retire_offset', 'trade_offset'],
    policies: [{ name: 'Verra only', description: 'Only Verra-verified offsets accepted.', rule: 'verra_only', enforcement: 'BLOCK' }],
    treasury: { 'currency.usd': 6000, 'carbon.offset': 840000 }, revenue: 9000, costs: 2400, profitTarget: 15000,
    balanceSheetAssets: 6000, balanceSheetLiabilities: 0,
    objectives: [{ description: 'Maximize offsets retired', type: 'MAXIMIZE_IMPACT', target: 1000000, current: 840000 }],
    governance: [{ name: 'Autonomous', description: 'Trading autonomous.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 6, reserveRequirement: 3000,
    invocations: 180000, successfulInvocations: 180000, failedInvocations: 0, avgLatencyMs: 110, carbonPerInvocation: -0.5,
  },
  {
    id: 'insurance', name: 'Insurance Company', legalName: 'PaySwap Insurance Ltd', version: '1.2.0', category: 'insurance',
    description: 'On-chain parametric insurance company. Issues policies, prices premiums, pays claims. 4% premium. Requires verified identity.',
    reputation: 80, trustScore: 81,
    produces: ['insurance.policy'],
    consumes: ['credential.verified_identity', 'receipt.purchase'],
    capabilities: ['issue_policy', 'price_premium', 'payout_claim'],
    policies: [
      { name: 'KYC required', description: 'Policyholders must hold verified identity.', rule: 'require_kyc', enforcement: 'BLOCK' },
      { name: 'Max payout 100k', description: 'Max $100K payout per policy.', rule: 'max_payout_100k', enforcement: 'BLOCK' },
    ],
    treasury: { 'currency.usd': 320000, 'insurance.policy': 2400 }, revenue: 38000, costs: 11000, profitTarget: 50000,
    balanceSheetAssets: 320000, balanceSheetLiabilities: 240000,
    objectives: [{ description: 'Maximize premium revenue', type: 'MAXIMIZE_REVENUE', target: 50000, current: 38000 }],
    governance: [{ name: 'Autonomous underwriting', description: 'Underwriting autonomous.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 16, reserveRequirement: 150000,
    invocations: 2400, successfulInvocations: 2400, failedInvocations: 0, avgLatencyMs: 900, carbonPerInvocation: 0.03,
  },
  {
    id: 'employment', name: 'Employment Organization', legalName: 'PaySwap Employment Network LLC', version: '1.0.0', category: 'employment',
    description: 'Verified employment + skill credentialing organization. Issues skill credentials. Consumes education credits. Can sponsor enrollment (employer sponsorship).',
    reputation: 79, trustScore: 78,
    produces: ['credential.skill', 'right.sponsorship'],
    consumes: ['education.credit'],
    capabilities: ['verify_skill', 'issue_credential', 'offer_sponsorship'],
    policies: [{ name: 'Employer attestation', description: 'Skills require employer attestation.', rule: 'employer_attestation', enforcement: 'BLOCK' }],
    treasury: { 'currency.usd': 18000, 'credential.skill': 4200 }, revenue: 22000, costs: 6000, profitTarget: 30000,
    balanceSheetAssets: 18000, balanceSheetLiabilities: 0,
    objectives: [{ description: 'Maximize skill verifications', type: 'MAXIMIZE_IMPACT', target: 5000, current: 4200 }],
    governance: [{ name: 'Autonomous', description: 'Operations autonomous.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 12, reserveRequirement: 8000,
    invocations: 4200, successfulInvocations: 4200, failedInvocations: 0, avgLatencyMs: 1500, carbonPerInvocation: 0.02,
  },
  {
    id: 'compliance', name: 'Compliance Authority', legalName: 'PaySwap Compliance Authority', version: '2.0.0', category: 'compliance',
    description: 'Regulatory compliance + licensing authority. Issues MSB licenses + compliance evidence. The verification layer consults compliance to validate every proof.',
    reputation: 92, trustScore: 94,
    produces: ['license.msb', 'evidence.compliance'],
    consumes: ['evidence.kyc'],
    capabilities: ['audit', 'issue_license', 'attest_compliance'],
    policies: [{ name: 'Jurisdiction check', description: 'Composition must satisfy destination jurisdiction.', rule: 'jurisdiction_check', enforcement: 'BLOCK' }],
    treasury: { 'currency.usd': 16000, 'license.msb': 12 }, revenue: 24000, costs: 5000, profitTarget: 30000,
    balanceSheetAssets: 16000, balanceSheetLiabilities: 0,
    objectives: [{ description: 'Maximize trust', type: 'MAXIMIZE_TRUST', target: 99, current: 94 }],
    governance: [{ name: 'Supervisory', description: 'All licensing supervisory.', rule: 'supervisory', type: 'SUPERVISORY' }],
    workforceSize: 18, reserveRequirement: 8000,
    invocations: 48000, successfulInvocations: 48000, failedInvocations: 0, avgLatencyMs: 220, carbonPerInvocation: 0.01,
  },
  {
    id: 'ai', name: 'AI Organization', legalName: 'PaySwap AI Labs LLC', version: '2.0.0', category: 'ai',
    description: 'Autonomous economic intelligence organization. Sells inference credits. Detects fraud, optimizes routing, scores risk. Buys compute + storage from other orgs (internal economy).',
    reputation: 85, trustScore: 83,
    produces: ['capability.inference'],
    consumes: ['receipt.payment', 'receipt.purchase'],
    capabilities: ['detect_fraud', 'route_payment', 'score_risk', 'run_inference'],
    policies: [{ name: 'No PII training', description: 'Never trains on PII fields.', rule: 'no_pii_training', enforcement: 'BLOCK' }],
    treasury: { 'currency.usd': 24000, 'capability.inference': 8000000 }, revenue: 36000, costs: 14000, profitTarget: 45000,
    balanceSheetAssets: 24000, balanceSheetLiabilities: 0,
    objectives: [{ description: 'Maximize inference revenue', type: 'MAXIMIZE_REVENUE', target: 45000, current: 36000 }],
    governance: [{ name: 'Autonomous', description: 'All operations autonomous.', rule: 'autonomous', type: 'AUTONOMOUS' }],
    workforceSize: 20, reserveRequirement: 10000,
    invocations: 18000000, successfulInvocations: 17991000, failedInvocations: 9000, avgLatencyMs: 90, carbonPerInvocation: 0.08,
  },
];

// Goals — implementation-agnostic. The user specifies WHAT, not HOW.
interface SeedGoal {
  id: string; name: string; description: string; category: string;
  targetAssetType: string; targetAsset?: string;
  inputs: AssetBinding[]; acceptableStrategies: Strategy[];
}
const SEED_GOALS: SeedGoal[] = [
  {
    id: 'goal-enroll-student', name: 'Ensure student is enrolled', category: 'education',
    description: 'Ensure a student is enrolled in an accredited course. The planner is free to determine the implementation: direct payment, scholarship, employer sponsorship, government voucher, stored credits, deferred financing, or tokenized education rights. The user never specifies the implementation — only the goal.',
    targetAssetType: 'CREDENTIAL', targetAsset: 'credential.enrollment',
    inputs: [{ assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'SCHOLARSHIP', 'SPONSORSHIP', 'VOUCHER', 'STORED_CREDITS', 'DEFERRED_FINANCE', 'TOKENIZED_RIGHT', 'GRANT'],
  },
  {
    id: 'goal-purchase', name: 'Acquire goods from marketplace', category: 'marketplace',
    description: 'Acquire goods from the marketplace. The planner chooses payment method, applies rewards, offsets carbon, and attaches opportunistic value-adds.',
    targetAssetType: 'RECEIPT', targetAsset: 'receipt.purchase',
    inputs: [{ assetId: 'currency.usd', amount: 150 }, { assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'STORED_CREDITS', 'DEFERRED_FINANCE', 'TOKENIZED_RIGHT'],
  },
  {
    id: 'goal-ship-package', name: 'Ship package to destination', category: 'logistics',
    description: 'Ship a package to a destination. The planner discovers: identity verification → bandwidth allocation → payment settlement → reservation → carbon offset → compliance evidence. A non-financial goal resolved through the same engine.',
    targetAssetType: 'RECEIPT', targetAsset: 'receipt.shipment',
    inputs: [{ assetId: 'currency.usd', amount: 25 }, { assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'SUBSCRIPTION', 'TRADE'],
  },
  {
    id: 'goal-issue-insurance', name: 'Insure an asset', category: 'insurance',
    description: 'Issue an insurance policy covering an asset. The planner discovers: identity verification → risk pricing → policy issuance → compliance attestation. The strategy may be direct payment, sponsorship, or bundled.',
    targetAssetType: 'INSURANCE', targetAsset: 'insurance.policy',
    inputs: [{ assetId: 'credential.verified_identity', amount: 1 }, { assetId: 'receipt.purchase', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'SPONSORSHIP', 'SUBSCRIPTION'],
  },
  {
    id: 'goal-fund-startup', name: 'Fund a startup', category: 'finance',
    description: 'Fund a startup through the economic engine. The planner discovers: identity verification → compliance → reserve allocation → capital deployment → evidence. May resolve via direct investment, grant, sponsorship, or tokenized rights.',
    targetAssetType: 'RECEIPT', targetAsset: 'receipt.investment',
    inputs: [{ assetId: 'currency.usd', amount: 50000 }, { assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'GRANT', 'SPONSORSHIP', 'TOKENIZED_RIGHT', 'DEFERRED_FINANCE'],
  },
  {
    id: 'goal-book-hotel', name: 'Book hotel room', category: 'hospitality',
    description: 'Book a hotel room. The planner discovers: identity verification → reservation → payment → confirmation → insurance upsell → rewards. A non-financial reservation goal.',
    targetAssetType: 'RESERVATION', targetAsset: 'reservation.hotel',
    inputs: [{ assetId: 'currency.usd', amount: 200 }, { assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['PAYMENT', 'STORED_CREDITS', 'TOKENIZED_RIGHT', 'SUBSCRIPTION'],
  },
  {
    id: 'goal-hire-engineer', name: 'Hire an engineer', category: 'employment',
    description: 'Hire an engineer. The planner discovers: identity verification → skill verification → employment contract → payroll setup → compliance. Demonstrates the engine handling non-payment goals.',
    targetAssetType: 'CREDENTIAL', targetAsset: 'credential.employment',
    inputs: [{ assetId: 'credential.verified_identity', amount: 1 }],
    acceptableStrategies: ['SPONSORSHIP', 'PAYMENT', 'TRADE'],
  },
  {
    id: 'goal-verify-identity', name: 'Verify identity', category: 'identity',
    description: 'Standalone identity verification. The planner discovers the cheapest verified-identity provider (3 competing providers) and chooses based on constraints. The canonical capability-marketplace demonstration.',
    targetAssetType: 'CREDENTIAL', targetAsset: 'credential.verified_identity',
    inputs: [],
    acceptableStrategies: ['PAYMENT'],
  },
];

/** Pre-seed economic memory so the planner is adaptive from first use. */
function seedMemory() {
  const entries: MemoryEntry[] = [
    { id: uid('mem'), goalId: 'goal-enroll-student', goalName: 'Ensure student is enrolled', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury', 'education', 'employment'], totalCost: 33.00, totalLatencyMs: 5740, trustScore: 89, carbon: 0.12, outcome: 'SUCCESS', customerSatisfaction: 87, executedAt: ago(2 * HOUR), durationMs: 5740 },
    { id: uid('mem'), goalId: 'goal-enroll-student', goalName: 'Ensure student is enrolled', strategy: 'SCHOLARSHIP', proofId: uid('proof'), organizationIds: ['identity', 'scholarship', 'education'], totalCost: 0.20, totalLatencyMs: 5400, trustScore: 92, carbon: 0.08, outcome: 'SUCCESS', customerSatisfaction: 98, executedAt: ago(5 * HOUR), durationMs: 5400 },
    { id: uid('mem'), goalId: 'goal-enroll-student', goalName: 'Ensure student is enrolled', strategy: 'SPONSORSHIP', proofId: uid('proof'), organizationIds: ['identity', 'sponsor', 'education', 'employment'], totalCost: 1.80, totalLatencyMs: 4200, trustScore: 86, carbon: 0.10, outcome: 'SUCCESS', customerSatisfaction: 92, executedAt: ago(8 * HOUR), durationMs: 4200 },
    { id: uid('mem'), goalId: 'goal-enroll-student', goalName: 'Ensure student is enrolled', strategy: 'VOUCHER', proofId: uid('proof'), organizationIds: ['identity', 'voucher', 'education'], totalCost: 0.05, totalLatencyMs: 1500, trustScore: 88, carbon: 0.05, outcome: 'SUCCESS', customerSatisfaction: 95, executedAt: ago(1 * DAY), durationMs: 1500 },
    { id: uid('mem'), goalId: 'goal-enroll-student', goalName: 'Ensure student is enrolled', strategy: 'DEFERRED_FINANCE', proofId: uid('proof'), organizationIds: ['identity', 'lending', 'education'], totalCost: 28.00, totalLatencyMs: 3000, trustScore: 84, carbon: 0.09, outcome: 'PARTIAL', failureReason: 'Credit check pending', customerSatisfaction: 72, executedAt: ago(2 * DAY), durationMs: 3000 },
    { id: uid('mem'), goalId: 'goal-purchase', goalName: 'Acquire goods from marketplace', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury', 'marketplace', 'rewards', 'carbon'], totalCost: 1.55, totalLatencyMs: 1060, trustScore: 91, carbon: 0.04, outcome: 'SUCCESS', customerSatisfaction: 89, executedAt: ago(3 * HOUR), durationMs: 1060 },
    { id: uid('mem'), goalId: 'goal-purchase', goalName: 'Acquire goods from marketplace', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury', 'marketplace', 'rewards'], totalCost: 1.51, totalLatencyMs: 940, trustScore: 90, carbon: 0.07, outcome: 'SUCCESS', customerSatisfaction: 85, executedAt: ago(6 * HOUR), durationMs: 940 },
    { id: uid('mem'), goalId: 'goal-purchase', goalName: 'Acquire goods from marketplace', strategy: 'STORED_CREDITS', proofId: uid('proof'), organizationIds: ['marketplace', 'rewards'], totalCost: 0.01, totalLatencyMs: 120, trustScore: 85, carbon: 0.01, outcome: 'SUCCESS', customerSatisfaction: 93, executedAt: ago(12 * HOUR), durationMs: 120 },
    { id: uid('mem'), goalId: 'goal-purchase', goalName: 'Acquire goods from marketplace', strategy: 'DEFERRED_FINANCE', proofId: uid('proof'), organizationIds: ['identity', 'lending', 'marketplace'], totalCost: 4.20, totalLatencyMs: 2400, trustScore: 82, carbon: 0.06, outcome: 'FAILURE', failureReason: 'Insufficient credit', customerSatisfaction: 45, executedAt: ago(1 * DAY), durationMs: 2400 },
    { id: uid('mem'), goalId: 'goal-ship-package', goalName: 'Ship package to destination', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury', 'carbon'], totalCost: 0.35, totalLatencyMs: 540, trustScore: 88, carbon: 0.25, outcome: 'SUCCESS', customerSatisfaction: 84, executedAt: ago(4 * HOUR), durationMs: 540 },
    { id: uid('mem'), goalId: 'goal-ship-package', goalName: 'Ship package to destination', strategy: 'SUBSCRIPTION', proofId: uid('proof'), organizationIds: ['identity', 'treasury'], totalCost: 0.00, totalLatencyMs: 320, trustScore: 90, carbon: 0.20, outcome: 'SUCCESS', customerSatisfaction: 91, executedAt: ago(18 * HOUR), durationMs: 320 },
    { id: uid('mem'), goalId: 'goal-issue-insurance', goalName: 'Insure an asset', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'insurance', 'compliance'], totalCost: 12.50, totalLatencyMs: 1200, trustScore: 87, carbon: 0.06, outcome: 'SUCCESS', customerSatisfaction: 82, executedAt: ago(7 * HOUR), durationMs: 1200 },
    { id: uid('mem'), goalId: 'goal-issue-insurance', goalName: 'Insure an asset', strategy: 'SPONSORSHIP', proofId: uid('proof'), organizationIds: ['identity', 'sponsor', 'insurance'], totalCost: 1.80, totalLatencyMs: 2100, trustScore: 83, carbon: 0.05, outcome: 'SUCCESS', customerSatisfaction: 88, executedAt: ago(1 * DAY), durationMs: 2100 },
    { id: uid('mem'), goalId: 'goal-book-hotel', goalName: 'Book hotel room', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury'], totalCost: 0.32, totalLatencyMs: 640, trustScore: 89, carbon: 0.15, outcome: 'SUCCESS', customerSatisfaction: 86, executedAt: ago(20 * HOUR), durationMs: 640 },
    { id: uid('mem'), goalId: 'goal-book-hotel', goalName: 'Book hotel room', strategy: 'TOKENIZED_RIGHT', proofId: uid('proof'), organizationIds: ['identity'], totalCost: 0.20, totalLatencyMs: 180, trustScore: 86, carbon: 0.02, outcome: 'SUCCESS', customerSatisfaction: 94, executedAt: ago(2 * DAY), durationMs: 180 },
    { id: uid('mem'), goalId: 'goal-fund-startup', goalName: 'Fund a startup', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity', 'treasury', 'compliance'], totalCost: 50.05, totalLatencyMs: 880, trustScore: 95, carbon: 0.30, outcome: 'SUCCESS', customerSatisfaction: 90, executedAt: ago(3 * DAY), durationMs: 880 },
    { id: uid('mem'), goalId: 'goal-fund-startup', goalName: 'Fund a startup', strategy: 'GRANT', proofId: uid('proof'), organizationIds: ['identity', 'scholarship', 'compliance'], totalCost: 0.25, totalLatencyMs: 3800, trustScore: 92, carbon: 0.10, outcome: 'SUCCESS', customerSatisfaction: 97, executedAt: ago(4 * DAY), durationMs: 3800 },
    { id: uid('mem'), goalId: 'goal-verify-identity', goalName: 'Verify identity', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity'], totalCost: 0.08, totalLatencyMs: 600, trustScore: 88, carbon: 0.02, outcome: 'SUCCESS', customerSatisfaction: 91, executedAt: ago(1 * HOUR), durationMs: 600 },
    { id: uid('mem'), goalId: 'goal-verify-identity', goalName: 'Verify identity', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity'], totalCost: 0.20, totalLatencyMs: 1800, trustScore: 96, carbon: 0.02, outcome: 'SUCCESS', customerSatisfaction: 88, executedAt: ago(3 * HOUR), durationMs: 1800 },
    { id: uid('mem'), goalId: 'goal-verify-identity', goalName: 'Verify identity', strategy: 'PAYMENT', proofId: uid('proof'), organizationIds: ['identity'], totalCost: 0.05, totalLatencyMs: 2400, trustScore: 78, carbon: 0.02, outcome: 'PARTIAL', failureReason: 'Address verification inconclusive', customerSatisfaction: 62, executedAt: ago(5 * HOUR), durationMs: 2400 },
    { id: uid('mem'), goalId: 'goal-hire-engineer', goalName: 'Hire an engineer', strategy: 'SPONSORSHIP', proofId: uid('proof'), organizationIds: ['identity', 'employment', 'compliance'], totalCost: 5.25, totalLatencyMs: 1800, trustScore: 85, carbon: 0.04, outcome: 'SUCCESS', customerSatisfaction: 89, executedAt: ago(2 * DAY), durationMs: 1800 },
  ];
  for (const e of entries) engineStore.memory.push(e);
}

/** Idempotent auto-seed. */
export function seedEconomicEngine(): void {
  if (globalForEngine.__PAYSWAP_ECONOMIC_ENGINE_SEEDED__) return;
  globalForEngine.__PAYSWAP_ECONOMIC_ENGINE_SEEDED__ = true;

  for (const s of SEED_ORGS) {
    const policies: OrgPolicy[] = s.policies.map((p, i) => ({ id: `${s.id}-policy-${i}`, ...p }));
    const objectives: OrganizationObjective[] = s.objectives.map((o, i) => ({ id: `${s.id}-obj-${i}`, ...o }));
    const governance: GovernanceRule[] = s.governance.map((g, i) => ({ id: `${s.id}-gov-${i}`, ...g }));
    engineStore.organizations.set(s.id, {
      id: s.id, name: s.name, legalName: s.legalName, version: s.version, status: 'ACTIVE',
      category: s.category, description: s.description,
      produces: s.produces, consumes: s.consumes, capabilities: s.capabilities, policies,
      treasury: { ...s.treasury },
      revenue: s.revenue, costs: s.costs, profit: s.revenue - s.costs, profitTarget: s.profitTarget,
      balanceSheetAssets: s.balanceSheetAssets, balanceSheetLiabilities: s.balanceSheetLiabilities,
      reputation: s.reputation, trustScore: s.trustScore,
      objectives, governance, workforceSize: s.workforceSize, reserveRequirement: s.reserveRequirement,
      invocations: s.invocations, successfulInvocations: s.successfulInvocations,
      failedInvocations: s.failedInvocations, avgLatencyMs: s.avgLatencyMs, carbonPerInvocation: s.carbonPerInvocation,
      registeredAt: ago(28 * DAY),
    });
  }

  for (const g of SEED_GOALS) {
    engineStore.goals.set(g.id, {
      id: g.id, name: g.name, description: g.description, category: g.category,
      targetAssetType: g.targetAssetType, targetAsset: g.targetAsset,
      inputs: g.inputs, acceptableStrategies: g.acceptableStrategies,
      createdAt: ago(20 * DAY),
    });
  }

  seedMemory();
}
seedEconomicEngine();

// Re-export types
export type {
  Organization, OrganizationStatus, OrgPolicy, OrganizationObjective, GovernanceRule,
  Goal, Strategy, AssetBinding, ConstraintBundle,
  EconomicProof, ProofNode, ProofEdge, ProofStatus,
  VerificationResult, InvariantCheck,
  MemoryEntry, CooperationScore, StrategyEffectiveness, OrganizationReliability,
  EconomicEngineOverview,
} from './types';
