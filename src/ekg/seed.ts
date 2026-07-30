/**
 * Economic Knowledge Graph — Seed.
 *
 * Populates the graph with entities (heterogeneous labels), capabilities,
 * assets, goals, policies, jurisdictions, and memory — all as typed nodes
 * connected by typed relationships. Capabilities are relationship hubs:
 *   Entity ──OFFERS──► Capability ──REQUIRES──► Asset
 *                        Capability ──PRODUCES──► Asset
 *                        Capability ──SATISFIES──► Goal
 *                        Capability ──CONSTRAINED_BY──► Policy
 *   Entity ──LOCATED_IN──► Jurisdiction
 */

import { ekg } from './graph';
import type { EntityLabel } from './types';

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => Date.now() - ms;

// Asset node ids (referenced by capabilities)
const ASSETS = {
  usd: 'asset.usd',
  ghs: 'asset.ghs',
  identity: 'asset.identity',
  enrollment: 'asset.enrollment',
  skill: 'asset.skill',
  sellerRep: 'asset.seller_rep',
  borrowerRep: 'asset.borrower_rep',
  carbon: 'asset.carbon',
  bandwidth: 'asset.bandwidth',
  loan: 'asset.loan',
  insurance: 'asset.insurance',
  paymentReceipt: 'asset.payment_receipt',
  purchaseReceipt: 'asset.purchase_receipt',
  tuitionReceipt: 'asset.tuition_receipt',
  kycEvidence: 'asset.kyc_evidence',
  complianceEvidence: 'asset.compliance_evidence',
  cashbackRight: 'asset.cashback_right',
  scholarshipRight: 'asset.scholarship_right',
  voucherRight: 'asset.voucher_right',
  knowledge: 'asset.knowledge',
  inference: 'asset.inference',
  storage: 'asset.storage',
  gpu: 'asset.gpu',
  settlementProof: 'asset.settlement_proof',
};

// Jurisdiction node ids
const JURISDICTIONS = ['juris.gh', 'juris.ng', 'juris.ke', 'juris.tg', 'juris.eu', 'juris.us', 'juris.global'];

// Policy node ids
const POLICIES = {
  kycRequired: 'policy.kyc_required',
  solvencyFloor: 'policy.solvency_floor',
  maxExposure: 'policy.max_exposure',
  verraOnly: 'policy.verra_only',
  accreditation: 'policy.accreditation',
};

export function seedEKG(): void {
  const g = globalThis as unknown as { __PAYSWAP_EKG_SEEDED__?: boolean };
  if (g.__PAYSWAP_EKG_SEEDED__) return;
  g.__PAYSWAP_EKG_SEEDED__ = true;

  // ── Jurisdictions ──
  const jurisLabels: Record<string, string> = { 'juris.gh': 'Ghana', 'juris.ng': 'Nigeria', 'juris.ke': 'Kenya', 'juris.tg': 'Togo', 'juris.eu': 'European Union', 'juris.us': 'United States', 'juris.global': 'Global' };
  for (const id of JURISDICTIONS) {
    ekg.addNode('JURISDICTION', jurisLabels[id], { code: id.replace('juris.', '').toUpperCase() });
  }

  // ── Assets ──
  const assetDefs: Array<[string, string, string, Record<string, unknown>]> = [
    [ASSETS.usd, 'USD', 'CURRENCY', { unit: 'USD' }],
    [ASSETS.ghs, 'GHS', 'CURRENCY', { unit: 'GHS' }],
    [ASSETS.identity, 'Verified Identity', 'CREDENTIAL', { unit: 'cred' }],
    [ASSETS.enrollment, 'Enrollment', 'CREDENTIAL', { unit: 'cred' }],
    [ASSETS.skill, 'Skill', 'CREDENTIAL', { unit: 'cred' }],
    [ASSETS.sellerRep, 'Seller Reputation', 'REPUTATION', { unit: 'pts' }],
    [ASSETS.borrowerRep, 'Borrower Reputation', 'REPUTATION', { unit: 'pts' }],
    [ASSETS.carbon, 'Carbon Offset', 'CARBON', { unit: 'kgCO2e' }],
    [ASSETS.bandwidth, 'Liquidity Bandwidth', 'BANDWIDTH', { unit: 'USD' }],
    [ASSETS.loan, 'Loan', 'DEBT', { unit: 'USD' }],
    [ASSETS.insurance, 'Insurance Policy', 'INSURANCE', { unit: 'policy' }],
    [ASSETS.paymentReceipt, 'Payment Receipt', 'RECEIPT', { unit: 'receipt' }],
    [ASSETS.purchaseReceipt, 'Purchase Receipt', 'RECEIPT', { unit: 'receipt' }],
    [ASSETS.tuitionReceipt, 'Tuition Receipt', 'RECEIPT', { unit: 'receipt' }],
    [ASSETS.kycEvidence, 'KYC Evidence', 'EVIDENCE', { unit: 'record' }],
    [ASSETS.complianceEvidence, 'Compliance Evidence', 'EVIDENCE', { unit: 'record' }],
    [ASSETS.cashbackRight, 'Cashback Right', 'RIGHT', { unit: 'right' }],
    [ASSETS.scholarshipRight, 'Scholarship Right', 'RIGHT', { unit: 'right' }],
    [ASSETS.voucherRight, 'Voucher Right', 'RIGHT', { unit: 'right' }],
    [ASSETS.knowledge, 'Knowledge Insight', 'KNOWLEDGE', { unit: 'insight' }],
    [ASSETS.inference, 'AI Inference', 'INFERENCE', { unit: 'tokens' }],
    [ASSETS.storage, 'Storage', 'STORAGE', { unit: 'MB-hrs' }],
    [ASSETS.gpu, 'GPU Hours', 'GPU', { unit: 'hrs' }],
    [ASSETS.settlementProof, 'Settlement Proof', 'PROOF', { unit: 'proof' }],
  ];
  // Use stable ids for assets (so relationships can reference them)
  for (const [id, label, category, props] of assetDefs) {
    // We need stable ids — addNode generates random ids. For seed, we'll add then remap.
    // Actually, let's use a different approach: store the generated id in a lookup.
  }
  // Re-do with stable lookup
  const assetIds: Record<string, string> = {};
  for (const [id, label, category, props] of assetDefs) {
    const nodeId = ekg.addNode('ASSET', label, { ...props, stableId: id, category });
    assetIds[id] = nodeId;
  }

  // ── Policies ──
  const policyIds: Record<string, string> = {};
  policyIds.kycRequired = ekg.addNode('POLICY', 'KYC Required', { rule: 'require_kyc', enforcement: 'BLOCK', description: 'Identity verification required.' });
  policyIds.solvencyFloor = ekg.addNode('POLICY', 'Solvency Floor', { rule: 'min_solvency_100', enforcement: 'BLOCK', description: 'Reserve coverage ≥ 100%.' });
  policyIds.maxExposure = ekg.addNode('POLICY', 'Max Exposure', { rule: 'max_exposure_50k', enforcement: 'BLOCK', description: 'Max $50K unsecured.' });
  policyIds.verraOnly = ekg.addNode('POLICY', 'Verra Only', { rule: 'verra_only', enforcement: 'BLOCK', description: 'Only Verra-verified offsets.' });
  policyIds.accreditation = ekg.addNode('POLICY', 'Accreditation', { rule: 'accredited_only', enforcement: 'BLOCK', description: 'Only accredited institutions.' });

  // ── Helper to add a capability + its relationships ──
  function addCapability(
    name: string, description: string, category: string,
    produces: string[], requires: string[],
    constrainedBy: string[] = [],
  ): string {
    const capId = ekg.addNode('CAPABILITY', name, { description, category });
    for (const a of produces) ekg.addRelationship(capId, assetIds[a], 'PRODUCES');
    for (const a of requires) ekg.addRelationship(capId, assetIds[a], 'REQUIRES');
    for (const p of constrainedBy) ekg.addRelationship(capId, policyIds[p], 'CONSTRAINED_BY');
    return capId;
  }

  // ── Capabilities ──
  const capVerifyIdentity = addCapability('Verify Identity', 'KYC identity verification.', 'identity', [ASSETS.identity, ASSETS.kycEvidence], []);
  const capSettlePayment = addCapability('Settle Payment', 'Settle a payment atomically.', 'finance', [ASSETS.paymentReceipt, ASSETS.settlementProof], [ASSETS.usd], ['solvencyFloor']);
  const capIssueEnrollment = addCapability('Issue Enrollment', 'Issue education credits + enrollment.', 'education', [ASSETS.enrollment, ASSETS.tuitionReceipt], [ASSETS.paymentReceipt, ASSETS.identity], ['accreditation', 'kycRequired']);
  const capAwardScholarship = addCapability('Award Scholarship', 'Award a merit/need scholarship.', 'education', [ASSETS.scholarshipRight], [ASSETS.identity], ['kycRequired']);
  const capIssueVoucher = addCapability('Issue Voucher', 'Issue a government voucher.', 'government', [ASSETS.voucherRight], [ASSETS.identity], ['kycRequired']);
  const capOriginateLoan = addCapability('Originate Loan', 'Originate an undercollateralized loan.', 'finance', [ASSETS.loan, ASSETS.borrowerRep], [ASSETS.identity, ASSETS.sellerRep], ['kycRequired', 'maxExposure']);
  const capProcessSale = addCapability('Process Sale', 'Process a marketplace sale.', 'marketplace', [ASSETS.purchaseReceipt, ASSETS.cashbackRight, ASSETS.sellerRep], [ASSETS.identity, ASSETS.paymentReceipt], ['kycRequired']);
  const capOffsetCarbon = addCapability('Offset Carbon', 'Offset carbon footprint.', 'environment', [ASSETS.carbon], [ASSETS.purchaseReceipt, ASSETS.paymentReceipt], ['verraOnly']);
  const capIssueInsurance = addCapability('Issue Insurance', 'Issue a parametric policy.', 'insurance', [ASSETS.insurance], [ASSETS.identity, ASSETS.purchaseReceipt], ['kycRequired']);
  const capVerifySkill = addCapability('Verify Skill', 'Verify + credential a skill.', 'employment', [ASSETS.skill], [ASSETS.enrollment], []);
  const capAttestCompliance = addCapability('Attest Compliance', 'Attest regulatory compliance.', 'compliance', [ASSETS.complianceEvidence], [ASSETS.kycEvidence], []);
  const capSummarize = addCapability('Summarize', 'Summarize text via AI.', 'ai', [ASSETS.knowledge], []);
  const capTranslate = addCapability('Translate', 'Translate text.', 'ai', [ASSETS.knowledge], []);
  const capDetectFraud = addCapability('Detect Fraud', 'Detect fraud in a transaction.', 'ai', [ASSETS.knowledge], [ASSETS.paymentReceipt]);
  const capRunInference = addCapability('Run Inference', 'Run an AI model inference.', 'ai', [ASSETS.inference], []);
  const capProvideStorage = addCapability('Provide Storage', 'Store data.', 'infrastructure', [ASSETS.storage], []);
  const capProvideGPU = addCapability('Provide GPU', 'Provide GPU compute.', 'infrastructure', [ASSETS.gpu], []);
  const capAllocateBandwidth = addCapability('Allocate Bandwidth', 'Allocate LP bandwidth.', 'finance', [ASSETS.bandwidth], [ASSETS.settlementProof]);

  // ── Helper to add an entity + its OFFERS + LOCATED_IN ──
  function addEntity(name: string, labels: EntityLabel[], props: Record<string, unknown>, offers: Array<{ capId: string; price: number; latencyMs: number; sla: number; region: string }>, jurisdictions: string[]) {
    const entityId = ekg.addNode('ENTITY', name, props, labels);
    for (const o of offers) {
      ekg.addRelationship(entityId, o.capId, 'OFFERS', { pricePerInvocation: o.price, latencyMs: o.latencyMs, slaSuccessRate: o.sla, capacity: 1000, region: o.region });
    }
    for (const j of jurisdictions) {
      const jurisNode = ekg.listNodes({ kind: 'JURISDICTION' }).find((n) => n.properties.code === j.toUpperCase());
      if (jurisNode) ekg.addRelationship(entityId, jurisNode.id, 'LOCATED_IN');
    }
    return entityId;
  }

  // ── Entities (heterogeneous labels) ──
  addEntity('Identity Authority', ['ORGANIZATION'], { trustScore: 96, reputation: 94, revenue: 42000, costs: 8400, invocations: 210000, reliabilityScore: 95, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.02 }, [{ capId: capVerifyIdentity, price: 0.20, latencyMs: 1800, sla: 0.999, region: 'global' }], ['gh', 'ng', 'ke', 'tg', 'eu', 'us']);
  addEntity('Treasury Corp', ['ORGANIZATION'], { trustScore: 98, reputation: 97, revenue: 480000, costs: 96000, invocations: 4800000, reliabilityScore: 99, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.01 }, [{ capId: capSettlePayment, price: 0.001, latencyMs: 320, sla: 0.9999, region: 'global' }, { capId: capAllocateBandwidth, price: 0.50, latencyMs: 80, sla: 0.999, region: 'global' }], ['gh', 'ng', 'ke', 'tg', 'eu', 'us']);
  addEntity('University of Ghana', ['ORGANIZATION'], { trustScore: 87, reputation: 88, revenue: 52000, costs: 14000, invocations: 32000, reliabilityScore: 88, reliabilityTrend: 'IMPROVING', carbonPerInvocation: 0.05 }, [{ capId: capIssueEnrollment, price: 1.50, latencyMs: 600, sla: 0.999, region: 'gh' }], ['gh', 'ng', 'ke']);
  addEntity('Accra Training Institute', ['ORGANIZATION'], { trustScore: 82, reputation: 80, revenue: 18000, costs: 5000, invocations: 8500, reliabilityScore: 84, reliabilityTrend: 'IMPROVING', carbonPerInvocation: 0.04 }, [{ capId: capIssueEnrollment, price: 1.20, latencyMs: 450, sla: 0.99, region: 'gh' }], ['gh']);
  addEntity('Marketplace Inc', ['ORGANIZATION'], { trustScore: 91, reputation: 89, revenue: 220000, costs: 68000, invocations: 880000, reliabilityScore: 90, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.03 }, [{ capId: capProcessSale, price: 0.01, latencyMs: 540, sla: 0.997, region: 'global' }], ['gh', 'ng', 'ke', 'tg']);
  addEntity('Micro-Bank Ltd', ['ORGANIZATION', 'BANK'], { trustScore: 84, reputation: 82, revenue: 86000, costs: 22000, invocations: 14000, reliabilityScore: 85, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.04 }, [{ capId: capOriginateLoan, price: 25, latencyMs: 2400, sla: 0.99, region: 'gh' }], ['gh', 'ng']);
  addEntity('Scholarship Foundation', ['ORGANIZATION'], { trustScore: 92, reputation: 90, revenue: 0, costs: 380000, invocations: 4800, reliabilityScore: 96, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.01 }, [{ capId: capAwardScholarship, price: 0, latencyMs: 3600, sla: 1.0, region: 'global' }], ['gh', 'ng', 'ke']);
  addEntity('Carbon Exchange', ['ORGANIZATION'], { trustScore: 73, reputation: 75, revenue: 9000, costs: 2400, invocations: 180000, reliabilityScore: 92, reliabilityTrend: 'IMPROVING', carbonPerInvocation: -0.5 }, [{ capId: capOffsetCarbon, price: 0.05, latencyMs: 110, sla: 1.0, region: 'global' }], ['eu']);
  addEntity('Compliance Authority', ['ORGANIZATION'], { trustScore: 94, reputation: 92, revenue: 24000, costs: 5000, invocations: 48000, reliabilityScore: 97, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.01 }, [{ capId: capAttestCompliance, price: 0.50, latencyMs: 220, sla: 1.0, region: 'global' }], ['gh', 'ng', 'ke', 'tg']);
  addEntity('Employment Network', ['ORGANIZATION'], { trustScore: 78, reputation: 79, revenue: 22000, costs: 6000, invocations: 4200, reliabilityScore: 86, reliabilityTrend: 'IMPROVING', carbonPerInvocation: 0.02 }, [{ capId: capVerifySkill, price: 5, latencyMs: 1500, sla: 1.0, region: 'gh' }], ['gh', 'ng']);

  // AI Models
  addEntity('Claude 3.5 Sonnet', ['AI_MODEL'], { trustScore: 88, reputation: 85, revenue: 36000, costs: 14000, invocations: 8200000, reliabilityScore: 91, reliabilityTrend: 'IMPROVING', carbonPerInvocation: 0.08 }, [{ capId: capSummarize, price: 0.003, latencyMs: 1200, sla: 0.999, region: 'global' }, { capId: capTranslate, price: 0.002, latencyMs: 800, sla: 0.999, region: 'global' }, { capId: capDetectFraud, price: 0.001, latencyMs: 60, sla: 0.999, region: 'global' }, { capId: capRunInference, price: 0.002, latencyMs: 200, sla: 0.9995, region: 'global' }], []);
  addEntity('GPT-4o', ['AI_MODEL'], { trustScore: 86, reputation: 84, revenue: 42000, costs: 18000, invocations: 9100000, reliabilityScore: 89, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.07 }, [{ capId: capSummarize, price: 0.005, latencyMs: 900, sla: 0.998, region: 'global' }, { capId: capTranslate, price: 0.003, latencyMs: 700, sla: 0.998, region: 'global' }, { capId: capRunInference, price: 0.003, latencyMs: 180, sla: 0.999, region: 'global' }], []);
  addEntity('Gemini 1.5 Pro', ['AI_MODEL'], { trustScore: 84, reputation: 82, revenue: 28000, costs: 12000, invocations: 6400000, reliabilityScore: 87, reliabilityTrend: 'IMPROVING', carbonPerInvocation: 0.06 }, [{ capId: capSummarize, price: 0.001, latencyMs: 1500, sla: 0.997, region: 'global' }, { capId: capTranslate, price: 0.001, latencyMs: 1000, sla: 0.997, region: 'global' }], []);

  // Humans
  addEntity('Ama Mensah (Translator)', ['HUMAN'], { trustScore: 90, reputation: 88, revenue: 12000, costs: 0, invocations: 3200, reliabilityScore: 95, reliabilityTrend: 'STABLE', carbonPerInvocation: 0 }, [{ capId: capTranslate, price: 0.15, latencyMs: 3600000, sla: 1.0, region: 'gh' }], ['gh']);
  addEntity('Sara Lee (Reviewer)', ['HUMAN'], { trustScore: 92, reputation: 90, revenue: 18000, costs: 0, invocations: 1800, reliabilityScore: 97, reliabilityTrend: 'STABLE', carbonPerInvocation: 0 }, [{ capId: capSummarize, price: 0.50, latencyMs: 7200000, sla: 1.0, region: 'global' }], ['us', 'eu']);

  // APIs
  addEntity('Stripe', ['API'], { trustScore: 95, reputation: 96, revenue: 0, costs: 0, invocations: 2400000, reliabilityScore: 98, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.005 }, [{ capId: capSettlePayment, price: 0.029, latencyMs: 500, sla: 0.9999, region: 'global' }], ['us', 'eu']);
  addEntity('AWS S3', ['API'], { trustScore: 96, reputation: 97, revenue: 0, costs: 0, invocations: 48000000, reliabilityScore: 99, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.001 }, [{ capId: capProvideStorage, price: 0.0003, latencyMs: 45, sla: 0.9999, region: 'global' }], []);
  addEntity('IPFS', ['API', 'BLOCKCHAIN'], { trustScore: 78, reputation: 76, revenue: 0, costs: 0, invocations: 8200000, reliabilityScore: 84, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.002 }, [{ capId: capProvideStorage, price: 0.0001, latencyMs: 200, sla: 0.997, region: 'global' }], []);

  // Bank
  addEntity('Ecobank', ['BANK'], { trustScore: 89, reputation: 87, revenue: 0, costs: 0, invocations: 1800000, reliabilityScore: 92, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.01 }, [{ capId: capSettlePayment, price: 0.015, latencyMs: 800, sla: 0.9995, region: 'gh' }], ['gh', 'ng', 'ke', 'tg']);

  // Government
  addEntity('Ghana Education Service', ['GOVERNMENT'], { trustScore: 95, reputation: 90, revenue: 0, costs: 0, invocations: 2400, reliabilityScore: 98, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.001 }, [{ capId: capIssueVoucher, price: 0, latencyMs: 900, sla: 1.0, region: 'gh' }], ['gh']);

  // Blockchain
  addEntity('Ethereum', ['BLOCKCHAIN'], { trustScore: 92, reputation: 90, revenue: 0, costs: 0, invocations: 9200000, reliabilityScore: 96, reliabilityTrend: 'STABLE', carbonPerInvocation: 0.15 }, [{ capId: capSettlePayment, price: 0.50, latencyMs: 12000, sla: 0.9999, region: 'global' }], []);

  // ── Goals ──
  const goalEnrollId = ekg.addNode('GOAL', 'Enroll Student', {
    targetAsset: assetIds[ASSETS.enrollment],
    inputs: { [assetIds[ASSETS.usd]]: 2000, [assetIds[ASSETS.identity]]: 1 },
    constraints: { budget: 50, minTrust: 80, jurisdiction: 'juris.gh' },
    description: 'Enroll a student in an accredited course.',
    createdAt: ago(20 * DAY),
  });
  ekg.addRelationship(capIssueEnrollment, goalEnrollId, 'SATISFIES');

  const goalSummarizeId = ekg.addNode('GOAL', 'Summarize Document', {
    targetAsset: assetIds[ASSETS.knowledge],
    inputs: {},
    constraints: { budget: 0.01, minTrust: 70 },
    description: 'Summarize a document via AI or human reviewer.',
    createdAt: ago(15 * DAY),
  });
  ekg.addRelationship(capSummarize, goalSummarizeId, 'SATISFIES');

  const goalPurchaseId = ekg.addNode('GOAL', 'Purchase Goods', {
    targetAsset: assetIds[ASSETS.purchaseReceipt],
    inputs: { [assetIds[ASSETS.usd]]: 150, [assetIds[ASSETS.identity]]: 1 },
    constraints: { budget: 5, minTrust: 75 },
    description: 'Buy goods on the marketplace.',
    createdAt: ago(15 * DAY),
  });
  ekg.addRelationship(capProcessSale, goalPurchaseId, 'SATISFIES');

  const goalSettleId = ekg.addNode('GOAL', 'Settle Payment', {
    targetAsset: assetIds[ASSETS.paymentReceipt],
    inputs: { [assetIds[ASSETS.usd]]: 500 },
    constraints: { budget: 1, minTrust: 90 },
    description: 'Settle a payment — heterogeneous providers compete (Treasury, Stripe, Ecobank, Ethereum).',
    createdAt: ago(15 * DAY),
  });
  ekg.addRelationship(capSettlePayment, goalSettleId, 'SATISFIES');

  const goalTranslateId = ekg.addNode('GOAL', 'Translate Text', {
    targetAsset: assetIds[ASSETS.knowledge],
    inputs: {},
    constraints: { budget: 0.20, minTrust: 75 },
    description: 'Translate text — AI models + humans compete.',
    createdAt: ago(15 * DAY),
  });
  ekg.addRelationship(capTranslate, goalTranslateId, 'SATISFIES');

  const goalStoreId = ekg.addNode('GOAL', 'Store Data', {
    targetAsset: assetIds[ASSETS.storage],
    inputs: {},
    constraints: { budget: 0.001, minTrust: 60 },
    description: 'Store data — AWS S3 vs IPFS compete.',
    createdAt: ago(15 * DAY),
  });
  ekg.addRelationship(capProvideStorage, goalStoreId, 'SATISFIES');

  // ── Memory (pre-seeded learning) ──
  const memoryRecords: Array<[string, string, string, Record<string, unknown>]> = [
    ['Executed: Enroll Student', 'SUCCESS', goalEnrollId, { totalCost: 1.70, totalLatencyMs: 2720, trustScore: 94, carbon: 0.08 }],
    ['Executed: Summarize Document', 'SUCCESS', goalSummarizeId, { totalCost: 0.003, totalLatencyMs: 1200, trustScore: 88, carbon: 0.08 }],
    ['Executed: Summarize Document', 'SUCCESS', goalSummarizeId, { totalCost: 0.005, totalLatencyMs: 900, trustScore: 86, carbon: 0.07 }],
    ['Executed: Summarize Document', 'SUCCESS', goalSummarizeId, { totalCost: 0.50, totalLatencyMs: 7200000, trustScore: 92, carbon: 0 }],
    ['Executed: Purchase Goods', 'SUCCESS', goalPurchaseId, { totalCost: 1.56, totalLatencyMs: 1060, trustScore: 89, carbon: 0.04 }],
    ['Executed: Settle Payment', 'SUCCESS', goalSettleId, { totalCost: 0.001, totalLatencyMs: 320, trustScore: 98, carbon: 0.01 }],
    ['Executed: Settle Payment', 'SUCCESS', goalSettleId, { totalCost: 0.029, totalLatencyMs: 500, trustScore: 95, carbon: 0.005 }],
    ['Executed: Translate Text', 'SUCCESS', goalTranslateId, { totalCost: 0.15, totalLatencyMs: 3600000, trustScore: 90, carbon: 0 }],
    ['Executed: Store Data', 'SUCCESS', goalStoreId, { totalCost: 0.0003, totalLatencyMs: 45, trustScore: 96, carbon: 0.001 }],
  ];
  for (const [label, outcome, goalId, props] of memoryRecords) {
    ekg.addNode('MEMORY', label, { ...props, outcome, goalId, executedAt: ago(Math.random() * 7 * DAY) });
  }
}
seedEKG();

/** Get goals as Goal objects (assembling from node properties). */
export function getGoals(): import('./types').Goal[] {
  return ekg.findGoals().map((n) => ({
    id: n.id, name: n.label,
    description: (n.properties.description as string) ?? '',
    targetAsset: (n.properties.targetAsset as string) ?? '',
    inputs: (n.properties.inputs as Record<string, number>) ?? {},
    constraints: (n.properties.constraints as import('./types').Constraints) ?? {},
    createdAt: (n.properties.createdAt as number) ?? Date.now(),
  }));
}
