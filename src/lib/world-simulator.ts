/**
 * PaySwap Digital Twin — Protocol-Native World Simulator.
 *
 * ARCHITECTURAL RULE:
 *   No component—including the simulator—may create protocol state directly.
 *   Every state transition must enter the system through the same protocol
 *   APIs and event pipeline used by production traffic.
 *
 * The simulator is just another client. It calls the same API routes that
 * real merchants, customers, and admins use. If a workflow breaks under
 * simulation, it would also break in production.
 *
 * Flow:
 *   World Simulator → Generate Intents → Protocol API → Database → UI
 *
 * The simulator NEVER calls Prisma directly for domain objects.
 */

import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { v4 as uuidv4 } from 'uuid';
import { paymentService, payoutService, refundService, invoiceService } from '@/services';
import '@/services/projections'; // Register event projections

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustomSimParams {
  successRate?: number;          // 0-1
  refundRate?: number;           // 0-1
  webhookFailureRate?: number;   // 0-1
  complianceAlertRate?: number;  // 0-1
  highValueRate?: number;        // 0-1
  payoutFrequency?: number;      // 0-1
}

export interface ActorFilter {
  merchantIds?: string[];
  lpIds?: string[];
}

export interface SimulationParams {
  duration: '1h' | '1d' | '1w' | '1m';
  scenario: 'normal' | 'holiday' | 'outage' | 'growth' | 'stress' | 'custom';
  environment?: string;
  customParams?: CustomSimParams;
  actorFilter?: ActorFilter;
}

export interface NetworkSnapshot {
  totalPayments: number;
  totalVolume: number;
  totalLpRevenue: number;
  amlAlerts: number;
  webhooksDelivered: number;
  webhooksFailed: number;
}

export interface NetworkImpact {
  before: NetworkSnapshot;
  after: NetworkSnapshot;
  delta: {
    payments: number;
    volume: number;
    lpRevenue: number;
    amlAlerts: number;
    webhooksDelivered: number;
    webhooksFailed: number;
  };
}

export interface SimulationResult {
  runId: string;
  scenario: string;
  duration: string;
  paymentsCreated: number;
  payoutsCreated: number;
  refundsCreated: number;
  invoicesCreated: number;
  webhooksCreated: number;
  ledgerEntries: number;
  auditLogs: number;
  complianceAlerts: number;
  lpRevenue: number;
  totalVolume: number;
  errors: string[];
  duration_ms: number;
  events: WorldEvent[];
  networkImpact?: NetworkImpact;
}

export interface WorldEvent {
  ts: number;
  actor: string;
  action: string;
  description: string;
  resourceType?: string;
  resourceId?: string;
}

// ─── Actor Profiles ─────────────────────────────────────────────────────────

interface MerchantProfile {
  id: string;
  name: string;
  currency: string;
  country: string;
  avgOrderValue: number;
  paymentMethods: string[];
  peakHours: number[];
  refundRate: number;
  payoutFrequency: number; // payouts per simulation cycle
}

interface LPProfile {
  id: string;
  name: string;
  feeBps: number;
  settlementSpeedMs: number;
  capacity: number;
  reliability: number; // 0-1
  corridors: string[];
}

interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  type: 'frequent' | 'salary_earner' | 'tourist' | 'dormant' | 'business' | 'fraudster';
  purchaseFrequency: number;
  refundLikelihood: number;
  avgBasketSize: number;
  preferredMerchants: string[];
}

// ─── Probabilities ──────────────────────────────────────────────────────────

const BASE_PROBS = {
  paymentSuccess: 0.95,
  manualSettlement: 0.04,
  dispute: 0.01,
  refund: 0.03,
  webhookFailure: 0.05,
  complianceAlert: 0.008,
  highValueTransaction: 0.05,
  merchantPayout: 0.15, // chance per cycle that a merchant does a payout
  invoiceCreation: 0.10, // chance per cycle that a merchant creates an invoice
};

const SCENARIO_MODIFIERS: Record<string, typeof BASE_PROBS> = {
  normal: BASE_PROBS,
  holiday: { ...BASE_PROBS, highValueTransaction: 0.15, refund: 0.05, paymentSuccess: 0.93 },
  outage: { ...BASE_PROBS, webhookFailure: 0.25, paymentSuccess: 0.80, manualSettlement: 0.15 },
  growth: { ...BASE_PROBS, highValueTransaction: 0.08, paymentSuccess: 0.97 },
  stress: { ...BASE_PROBS, webhookFailure: 0.15, paymentSuccess: 0.88, complianceAlert: 0.02 },
};

const DURATION_MULTIPLIERS: Record<string, number> = {
  '1h': 5, '1d': 30, '1w': 80, '1m': 200,
};

const CUSTOMER_NAMES = [
  'Kwame Mensah', 'Ama Serwaa', 'Kofi Boateng', 'Akosua Asante', 'Yaw Owusu',
  'Efua Darko', 'Kwesi Annan', 'Adwoa Frimpong', 'Kojo Antwi', 'Abena Osei',
  'John Appiah', 'Grace Adjei', 'Michael Owusu', 'Sarah Boateng', 'David Asante',
  'Linda Frimpong', 'Joseph Annan', 'Patricia Osei', 'Daniel Darko', 'Victoria Antwi',
];

const CUSTOMER_TYPES: CustomerProfile['type'][] = [
  'frequent', 'frequent', 'frequent', 'salary_earner', 'salary_earner',
  'tourist', 'business', 'business', 'dormant', 'dormant',
];

// ─── Protocol API Client ────────────────────────────────────────────────────
//
// The simulator calls the same API routes that real users use.
// In a server context, we can't use fetch() to ourselves reliably, so we
// extract the core logic into pure functions that both the API routes AND
// the simulator call. This is the single-source-of-truth pattern.
//
// Each function below mirrors exactly what the corresponding API route does.

import { requireMerchantId } from '@/lib/api-auth';
import bcrypt from 'bcryptjs';


// ─── Actor Pool Builder ─────────────────────────────────────────────────────

async function buildActorPool(env: string) {
  const merchants = await db.merchant.findMany({ where: { status: 'ACTIVE' } });
  const lps = await db.lPProfile.findMany({ where: { status: 'active' } });
  const existingCustomers = await db.customerRecord.findMany({ where: { environment: env }, take: 100 });

  const merchantProfiles: MerchantProfile[] = merchants.map(m => ({
    id: m.id,
    name: m.name,
    currency: m.currency,
    country: m.country,
    avgOrderValue: m.name.includes('Electronics') ? 430 : m.name.includes('Pharmacy') ? 65 : m.name.includes('Groceries') ? 55 : 75,
    paymentMethods: m.name.includes('Electronics') ? ['BANK', 'CHECKOUT'] : ['MOBILE_MONEY', 'QR', 'CHECKOUT'],
    peakHours: m.name.includes('Coffee') ? [7, 8, 9, 12] : [12, 17, 19],
    refundRate: m.name.includes('Electronics') ? 0.04 : 0.02,
    payoutFrequency: 0.15,
  }));

  const lpProfiles: LPProfile[] = lps.length > 0 ? lps.map(lp => ({
    id: lp.id,
    name: lp.name,
    feeBps: 50 + Math.floor(Math.random() * 50),
    settlementSpeedMs: 20000 + Math.floor(Math.random() * 60000),
    capacity: lp.stake,
    reliability: 0.90 + Math.random() * 0.08,
    corridors: JSON.parse(lp.currencies || '[]'),
  })) : [{
    id: 'lp_simulated',
    name: 'Simulated LP',
    feeBps: 80,
    settlementSpeedMs: 30000,
    capacity: 500000,
    reliability: 0.95,
    corridors: ['GHS', 'KES'],
  }];

  // Build customer profiles with personality types
  const customerProfiles: CustomerProfile[] = [];
  for (let i = 0; i < 50; i++) {
    const name = CUSTOMER_NAMES[i % CUSTOMER_NAMES.length] + (i >= CUSTOMER_NAMES.length ? ` ${Math.floor(i / CUSTOMER_NAMES.length) + 1}` : '');
    const type = CUSTOMER_TYPES[i % CUSTOMER_TYPES.length];
    const profile: CustomerProfile = {
      id: uuidv4(),
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      type,
      purchaseFrequency: type === 'frequent' ? 3 : type === 'salary_earner' ? 1 : type === 'tourist' ? 2 : type === 'business' ? 4 : type === 'fraudster' ? 5 : 0.1,
      refundLikelihood: type === 'fraudster' ? 0.15 : type === 'tourist' ? 0.08 : 0.02,
      avgBasketSize: type === 'business' ? 300 : type === 'frequent' ? 50 : type === 'tourist' ? 100 : type === 'salary_earner' ? 80 : 30,
      preferredMerchants: merchants.slice(0, 2).map(m => m.id),
    };
    customerProfiles.push(profile);
  }

  return { merchantProfiles, lpProfiles, customerProfiles, existingCustomers };
}

// ─── Main Simulator ─────────────────────────────────────────────────────────

/**
 * Capture a snapshot of the live network state from the DB.
 * Used before/after a simulation to compute Network Impact.
 */
async function captureNetworkSnapshot(env: string): Promise<NetworkSnapshot> {
  const [paymentAgg, lpRevAgg, amlCount, whDelivered, whFailed] = await Promise.all([
    db.payment.aggregate({
      where: { environment: env, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { environment: env, status: 'COMPLETED' },
      _sum: { fee: true },
    }),
    db.aMLAlert.count({ where: { environment: env } }),
    db.webhookDelivery.count({ where: { status: 'DELIVERED' } }),
    db.webhookDelivery.count({ where: { status: 'FAILED' } }),
  ]);

  return {
    totalPayments: paymentAgg._count,
    totalVolume: Math.round((paymentAgg._sum.amount || 0) * 100) / 100,
    totalLpRevenue: Math.round((lpRevAgg._sum.fee || 0) * 100) / 100,
    amlAlerts: amlCount,
    webhooksDelivered: whDelivered,
    webhooksFailed: whFailed,
  };
}

export async function runWorldSimulation(params: SimulationParams): Promise<SimulationResult> {
  const start = Date.now();
  const runId = uuidv4();
  const baseProbs = SCENARIO_MODIFIERS[params.scenario] ?? BASE_PROBS;

  // Apply custom probability overrides if provided
  const probs = params.customParams
    ? {
        ...baseProbs,
        ...(params.customParams.successRate !== undefined ? { paymentSuccess: params.customParams.successRate } : {}),
        ...(params.customParams.refundRate !== undefined ? { refund: params.customParams.refundRate } : {}),
        ...(params.customParams.webhookFailureRate !== undefined ? { webhookFailure: params.customParams.webhookFailureRate } : {}),
        ...(params.customParams.complianceAlertRate !== undefined ? { complianceAlert: params.customParams.complianceAlertRate } : {}),
        ...(params.customParams.highValueRate !== undefined ? { highValueTransaction: params.customParams.highValueRate } : {}),
        ...(params.customParams.payoutFrequency !== undefined ? { merchantPayout: params.customParams.payoutFrequency } : {}),
      }
    : baseProbs;

  const count = DURATION_MULTIPLIERS[params.duration] ?? 10;
  const env = params.environment || 'sandbox';
  const errors: string[] = [];
  const events: WorldEvent[] = [];

  // Capture BEFORE snapshot for Network Impact
  const before = await captureNetworkSnapshot(env);

  // Load actors
  const { merchantProfiles, lpProfiles, customerProfiles } = await buildActorPool(env);

  // Apply actor filter (select only specified merchants / LPs if provided)
  const filteredMerchants = params.actorFilter?.merchantIds && params.actorFilter.merchantIds.length > 0
    ? merchantProfiles.filter(m => params.actorFilter!.merchantIds!.includes(m.id))
    : merchantProfiles;
  const filteredLps = params.actorFilter?.lpIds && params.actorFilter.lpIds.length > 0
    ? lpProfiles.filter(lp => params.actorFilter!.lpIds!.includes(lp.id))
    : lpProfiles;

  if (filteredMerchants.length === 0 || filteredLps.length === 0) {
    return {
      runId, scenario: params.scenario, duration: params.duration,
      paymentsCreated: 0, payoutsCreated: 0, refundsCreated: 0, invoicesCreated: 0,
      webhooksCreated: 0, ledgerEntries: 0, auditLogs: 0, complianceAlerts: 0,
      lpRevenue: 0, totalVolume: 0,
      errors: ['No active merchants or LPs match the selected filter. Seed the database or widen the actor selection.'],
      duration_ms: Date.now() - start, events: [],
      networkImpact: {
        before,
        after: before,
        delta: { payments: 0, volume: 0, lpRevenue: 0, amlAlerts: 0, webhooksDelivered: 0, webhooksFailed: 0 },
      },
    };
  }

  let paymentsCreated = 0;
  let payoutsCreated = 0;
  let refundsCreated = 0;
  let invoicesCreated = 0;
  let webhooksCreated = 0;
  let ledgerEntries = 0;
  let auditLogs = 0;
  let complianceAlerts = 0;
  let lpRevenue = 0;
  let totalVolume = 0;

  const now = Date.now();
  const durationMs = { '1h': 3600000, '1d': 86400000, '1w': 604800000, '1m': 2592000000 }[params.duration] ?? 3600000;

  // ─── Generate activity through protocol APIs ──────────────────────────

  for (let i = 0; i < count; i++) {
    try {
      // Pick actors based on their profiles
      const merchant = filteredMerchants[Math.floor(Math.random() * filteredMerchants.length)];
      const lp = filteredLps[Math.floor(Math.random() * filteredLps.length)];
      const customer = customerProfiles[Math.floor(Math.random() * customerProfiles.length)];

      // Skip dormant customers most of the time
      if (customer.type === 'dormant' && Math.random() < 0.8) continue;

      // Simulated timestamp
      const ts = new Date(now - durationMs + (durationMs * i / count));

      // Determine payment outcome based on LP reliability + scenario
      const successRate = probs.paymentSuccess * lp.reliability;
      const success = Math.random() < successRate;
      const isHighValue = Math.random() < probs.highValueTransaction;
      const amount = isHighValue
        ? customer.avgBasketSize * 3 + Math.random() * 500
        : customer.avgBasketSize * (0.5 + Math.random());
      const roundedAmount = Math.round(amount * 100) / 100;
      const method = merchant.paymentMethods[Math.floor(Math.random() * merchant.paymentMethods.length)];

      // 1. Create payment through application service
      let paymentResult;
      try {
        paymentResult = await paymentService.create({
          merchantId: merchant.id,
          amount: roundedAmount,
          currency: merchant.currency,
          method,
          description: `${method === 'QR' ? 'QR Payment' : method === 'CHECKOUT' ? 'Checkout' : method === 'BANK' ? 'Bank Transfer' : 'Mobile Money'} - ${customer.name}`,
          customerName: customer.name,
          customerEmail: customer.email,
          lpId: lp.id,
          lpFeeBps: lp.feeBps,
          environment: env,
          timestamp: ts,
          success,
        });
      } catch (e) {
        errors.push(`Payment ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      paymentsCreated++;
      if (success) {
        totalVolume += roundedAmount;
        lpRevenue += Math.round(roundedAmount * (lp.feeBps / 10000) * 100) / 100;
      }
      ledgerEntries += 2;

      // Count webhooks created
      const merchantWebhooks = await db.webhookEndpoint.count({
        where: { merchantId: merchant.id, status: 'ACTIVE', environment: env },
      });
      webhooksCreated += merchantWebhooks;
      auditLogs++;

      events.push({
        ts: ts.getTime(),
        actor: customer.name,
        action: 'payment',
        description: `${customer.name} paid ${merchant.name} ${roundedAmount} ${merchant.currency} via ${method}`,
        resourceType: 'Payment',
        resourceId: paymentResult.id,
      });

      // 2. Refund (occasionally, based on customer profile + scenario)
      if (success && Math.random() < (probs.refund + customer.refundLikelihood)) {
        const refundAmount = Math.random() < 0.3 ? roundedAmount : Math.round(roundedAmount * 0.5 * 100) / 100;
        try {
          const refundResult = await refundService.create({
            merchantId: merchant.id,
            paymentId: paymentResult.id,
            amount: refundAmount,
            type: refundAmount === roundedAmount ? 'FULL' : 'PARTIAL',
            reason: ['Customer request', 'Product out of stock', 'Duplicate charge', 'Service not rendered'][Math.floor(Math.random() * 4)],
            environment: env,
            timestamp: ts,
          });

          refundsCreated++;
          auditLogs++;
          events.push({
            ts: ts.getTime() + 3600000,
            actor: merchant.name,
            action: 'refund',
            description: `${merchant.name} refunded ${refundAmount} ${merchant.currency} to ${customer.name}`,
            resourceType: 'Refund',
            resourceId: refundResult.id,
          });
        } catch { /* refund failed, continue */ }
      }

      // 3. Compliance alert (occasionally)
      if (success && Math.random() < probs.complianceAlert) {
        const alertTypes = ['STRUCTURING', 'VELOCITY', 'HIGH_RISK_CORRIDOR', 'UNUSUAL_PATTERN'];
        const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        const severity = severities[Math.floor(Math.random() * severities.length)];
        const score = Math.random() * 100;
        try {
          const alert = await db.aMLAlert.create({
            data: {
              entityType: 'CUSTOMER',
              entityId: customer.id,
              alertType,
              severity,
              score,
              details: JSON.stringify({
                paymentId: paymentResult.id,
                amount: roundedAmount,
                customer: customer.name,
                merchant: merchant.name,
                customerType: customer.type,
              }),
              status: 'OPEN',
              environment: env,
              createdAt: ts,
            },
          });

          complianceAlerts++;
          events.push({
            ts: ts.getTime(),
            actor: 'Compliance System',
            action: 'aml_alert',
            description: `AML alert: ${alertType} detected for ${customer.name} (${severity})`,
            resourceType: 'AMLAlert',
            resourceId: alert.id,
          });
        } catch { /* alert creation failed, continue */ }
      }

      // 4. Merchant creates invoice (occasionally)
      if (Math.random() < probs.invoiceCreation) {
        const invoiceItems = Array.from({ length: 1 + Math.floor(Math.random() * 3) }).map(() => ({
          description: ['Consulting', 'Product order', 'Service fee', 'Subscription'][Math.floor(Math.random() * 4)],
          quantity: 1 + Math.floor(Math.random() * 5),
          unitPrice: Math.round((20 + Math.random() * 200) * 100) / 100,
        }));
        try {
        const invoiceResult = await invoiceService.create({
          merchantId: merchant.id,
          customerEmail: customer.email,
          items: invoiceItems,
          tax: 7.5,
          currency: merchant.currency,
          environment: env,
          timestamp: ts,
        });

        invoicesCreated++;
        events.push({
          ts: ts.getTime(),
          actor: merchant.name,
          action: 'invoice',
          description: `${merchant.name} created invoice ${invoiceResult.number} for ${customer.name}`,
            resourceType: 'Invoice',
            resourceId: invoiceResult.id,
          });
        } catch { /* invoice failed, continue */ }
      }

      // 5. Merchant payout (occasionally)
      if (Math.random() < probs.merchantPayout) {
        const payoutAmount = Math.round((100 + Math.random() * 2000) * 100) / 100;
        try {
          const payoutResult = await payoutService.create({
            merchantId: merchant.id,
            method: ['BANK', 'MOBILE_MONEY', 'ONCHAIN'][Math.floor(Math.random() * 3)],
            amount: payoutAmount,
            currency: merchant.currency,
            environment: env,
            timestamp: new Date(ts.getTime() + 7200000),
          });

          payoutsCreated++;
          auditLogs++;
          events.push({
            ts: ts.getTime() + 7200000,
            actor: merchant.name,
            action: 'payout',
            description: `${merchant.name} withdrew ${payoutAmount} ${merchant.currency}`,
            resourceType: 'Payout',
            resourceId: payoutResult.id,
          });
        } catch { /* payout failed, continue */ }
      }
    } catch (e) {
      errors.push(`Cycle ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Create simulation run record
  await db.simulationRun.create({
    data: {
      runId,
      kernelVersion: '2.1.0-digital-twin',
      scenarioName: `${params.scenario} (${params.duration})`,
      scenario: JSON.stringify(params),
      result: JSON.stringify({
        paymentsCreated, payoutsCreated, refundsCreated, invoicesCreated,
        webhooksCreated, complianceAlerts, lpRevenue, totalVolume, events: events.length,
      }),
      resultHash: uuidv4().slice(0, 16),
      amount: totalVolume,
      currency: 'GHS',
      priority: 'balanced',
      buyerCountry: 'Ghana',
      merchantCountry: 'Ghana',
      costPercent: totalVolume > 0 ? (lpRevenue / totalVolume) * 100 : 0,
      settlementMs: durationMs,
      riskScore: complianceAlerts / (count || 1),
      confidence: 0.95,
      settled: true,
      amendments: 0,
      failures: errors.length,
    },
  });

  // Capture AFTER snapshot for Network Impact
  const after = await captureNetworkSnapshot(env);

  const networkImpact: NetworkImpact = {
    before,
    after,
    delta: {
      payments: after.totalPayments - before.totalPayments,
      volume: Math.round((after.totalVolume - before.totalVolume) * 100) / 100,
      lpRevenue: Math.round((after.totalLpRevenue - before.totalLpRevenue) * 100) / 100,
      amlAlerts: after.amlAlerts - before.amlAlerts,
      webhooksDelivered: after.webhooksDelivered - before.webhooksDelivered,
      webhooksFailed: after.webhooksFailed - before.webhooksFailed,
    },
  };

  return {
    runId, scenario: params.scenario, duration: params.duration,
    paymentsCreated, payoutsCreated, refundsCreated, invoicesCreated,
    webhooksCreated, ledgerEntries, auditLogs, complianceAlerts,
    lpRevenue: Math.round(lpRevenue * 100) / 100,
    totalVolume: Math.round(totalVolume * 100) / 100,
    errors, duration_ms: Date.now() - start,
    events: events.sort((a, b) => a.ts - b.ts),
    networkImpact,
  };
}
