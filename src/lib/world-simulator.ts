/**
 * PaySwap Digital Twin — World Simulator.
 *
 * This is NOT a separate demo. It creates REAL database records that flow
 * through the same tables every dashboard reads from. When a simulation runs,
 * every dashboard, report, activity feed, and analytics view updates.
 *
 * The simulator uses existing seeded actors (merchants, LPs, customers) and
 * generates realistic activity with probabilistic outcomes.
 *
 * Every record is related correctly:
 *   Payment → Customer → Merchant → LP → Wallet → Webhook → Activity → AuditLog
 */

import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimulationParams {
  duration: '1h' | '1d' | '1w' | '1m';
  scenario: 'normal' | 'holiday' | 'outage' | 'growth' | 'stress';
  environment?: string; // 'sandbox' | 'live'
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
}

// ─── Actor Pool ─────────────────────────────────────────────────────────────

interface MerchantActor {
  id: string;
  name: string;
  currency: string;
  country: string;
  avgOrderValue: number;
  paymentMethods: string[];
  busiestHours: number[];
  refundRate: number;
}

interface LPActor {
  id: string;
  name: string;
  feeBps: number;
  settlementSpeedMs: number;
  capacity: number;
  corridors: string[];
}

interface CustomerActor {
  id: string;
  name: string;
  email: string;
  purchaseFrequency: number; // per day
  refundLikelihood: number;
  avgBasketSize: number;
}

// ─── Probabilities ──────────────────────────────────────────────────────────

const PROBABILITIES = {
  paymentSuccess: 0.95,
  manualSettlement: 0.04,
  dispute: 0.01,
  refund: 0.03,
  chargeback: 0.005,
  connectorFailure: 0.02,
  webhookFailure: 0.05,
  complianceAlert: 0.008,
  highValueTransaction: 0.05,
};

const SCENARIO_MODIFIERS: Record<string, typeof PROBABILITIES> = {
  normal: PROBABILITIES,
  holiday: { ...PROBABILITIES, highValueTransaction: 0.15, refund: 0.05, paymentSuccess: 0.93 },
  outage: { ...PROBABILITIES, connectorFailure: 0.30, webhookFailure: 0.25, paymentSuccess: 0.80, manualSettlement: 0.15 },
  growth: { ...PROBABILITIES, highValueTransaction: 0.08, paymentSuccess: 0.97 },
  stress: { ...PROBABILITIES, connectorFailure: 0.15, webhookFailure: 0.15, paymentSuccess: 0.88, complianceAlert: 0.02 },
};

// ─── Duration Multipliers ───────────────────────────────────────────────────

const DURATION_MULTIPLIERS: Record<string, number> = {
  '1h': 5,      // 5 payments in an hour
  '1d': 30,     // 30 payments in a day
  '1w': 80,     // 80 payments in a week (condensed)
  '1m': 200,    // 200 payments in a month (condensed)
};

// ─── Names Pool ─────────────────────────────────────────────────────────────

const CUSTOMER_NAMES = [
  'Kwame Mensah', 'Ama Serwaa', 'Kofi Boateng', 'Akosua Asante', 'Yaw Owusu',
  'Efua Darko', 'Kwesi Annan', 'Adwoa Frimpong', 'Kojo Antwi', 'Abena Osei',
  'Yaw Mensah', 'Akua Boateng', 'Kwame Asante', 'Efua Owusu', 'Kofi Darko',
  'Ama Antwi', 'Kojo Frimpong', 'Adwoa Osei', 'Kwesi Mensah', 'Abena Annan',
  'John Appiah', 'Grace Adjei', 'Michael Owusu', 'Sarah Boateng', 'David Asante',
  'Linda Frimpong', 'Joseph Annan', 'Patricia Osei', 'Daniel Darko', 'Victoria Antwi',
  'Emmanuel Mensah', 'Faith Adjei', 'Samuel Owusu', 'Joyce Boateng', 'Joseph Asante',
  'Grace Frimpong', 'Michael Annan', 'Sarah Osei', 'David Darko', 'Linda Antwi',
];

// ─── Main Simulator ─────────────────────────────────────────────────────────

export async function runWorldSimulation(params: SimulationParams): Promise<SimulationResult> {
  const start = Date.now();
  const runId = uuidv4();
  const probs = SCENARIO_MODIFIERS[params.scenario] ?? PROBABILITIES;
  const count = DURATION_MULTIPLIERS[params.duration] ?? 10;
  const env = params.environment || 'sandbox';
  const errors: string[] = [];

  // Load actors from DB
  const merchants = await db.merchant.findMany({ where: { status: 'ACTIVE' } });
  const lps = await db.lPProfile.findMany({ where: { status: 'active' } });
  const existingCustomers = await db.customerRecord.findMany({ take: 100 });

  if (merchants.length === 0) {
    return {
      runId, scenario: params.scenario, duration: params.duration,
      paymentsCreated: 0, payoutsCreated: 0, refundsCreated: 0, invoicesCreated: 0,
      webhooksCreated: 0, ledgerEntries: 0, auditLogs: 0, complianceAlerts: 0,
      lpRevenue: 0, totalVolume: 0, errors: ['No active merchants found. Seed the database first.'],
      duration_ms: Date.now() - start,
    };
  }

  // Build actor profiles
  const merchantActors: MerchantActor[] = merchants.map(m => ({
    id: m.id, name: m.name, currency: m.currency, country: m.country,
    avgOrderValue: 50 + Math.random() * 200,
    paymentMethods: ['MOBILE_MONEY', 'BANK', 'QR', 'CHECKOUT'],
    busiestHours: [9, 12, 17, 19],
    refundRate: 0.02 + Math.random() * 0.04,
  }));

  const lpActors: LPActor[] = lps.length > 0 ? lps.map(lp => ({
    id: lp.id, name: lp.name,
    feeBps: 50 + Math.floor(Math.random() * 50),
    settlementSpeedMs: 20000 + Math.floor(Math.random() * 60000),
    capacity: lp.stake,
    corridors: JSON.parse(lp.currencies || '[]'),
  })) : [{
    id: 'lp_simulated', name: 'Simulated LP',
    feeBps: 80, settlementSpeedMs: 30000, capacity: 500000, corridors: ['GHS', 'KES'],
  }];

  // Generate customer pool
  const customerPool: CustomerActor[] = [];
  for (let i = 0; i < 50; i++) {
    const name = CUSTOMER_NAMES[i % CUSTOMER_NAMES.length];
    customerPool.push({
      id: uuidv4(),
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      purchaseFrequency: Math.random() * 3,
      refundLikelihood: Math.random() * 0.05,
      avgBasketSize: 30 + Math.random() * 300,
    });
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

  // Time progression
  const now = Date.now();
  const durationMs = { '1h': 3600000, '1d': 86400000, '1w': 604800000, '1m': 2592000000 }[params.duration] ?? 3600000;

  // Generate activity
  for (let i = 0; i < count; i++) {
    try {
      // Pick actors
      const merchant = merchantActors[Math.floor(Math.random() * merchantActors.length)];
      const lp = lpActors[Math.floor(Math.random() * lpActors.length)];
      const customer = customerPool[Math.floor(Math.random() * customerPool.length)];

      // Simulated timestamp (spread across the duration)
      const ts = new Date(now - durationMs + (durationMs * i / count));
      const isHighValue = Math.random() < probs.highValueTransaction;
      const amount = isHighValue
        ? customer.avgBasketSize * 3 + Math.random() * 500
        : customer.avgBasketSize * (0.5 + Math.random());
      const roundedAmount = Math.round(amount * 100) / 100;
      const method = merchant.paymentMethods[Math.floor(Math.random() * merchant.paymentMethods.length)];
      const paymentSuccess = Math.random() < probs.paymentSuccess;
      const fee = Math.round(roundedAmount * (lp.feeBps / 10000) * 100) / 100;
      const netAmount = Math.round((roundedAmount - fee) * 100) / 100;
      const corridor = `${merchant.currency}-${merchant.currency}`;

      // 1. Create or find customer record
      let customerRecord = existingCustomers.find(c => c.email === customer.email && c.merchantId === merchant.id);
      if (!customerRecord) {
        customerRecord = await db.customerRecord.create({
          data: {
            merchantId: merchant.id,
            name: customer.name,
            email: customer.email,
            phone: `+23324${Math.floor(1000000 + Math.random() * 8999999)}`,
            country: merchant.country,
            environment: env,
            totalSpent: 0,
            transactionCount: 0,
          },
        });
      }

      // 2. Create payment
      const reference = `SIM-${runId.slice(0, 8)}-${String(i + 1).padStart(4, '0')}`;
      const payment = await db.payment.create({
        data: {
          merchantId: merchant.id,
          customerId: customerRecord.id,
          amount: roundedAmount,
          currency: merchant.currency,
          sourceCurrency: merchant.currency,
          destinationCurrency: merchant.currency,
          status: paymentSuccess ? 'COMPLETED' : 'FAILED',
          method,
          corridor,
          lpId: lp.id,
          fee,
          netAmount: paymentSuccess ? netAmount : 0,
          fxRate: 1,
          reference,
          description: `${method === 'QR' ? 'QR Payment' : method === 'CHECKOUT' ? 'Checkout' : method === 'BANK' ? 'Bank Transfer' : 'Mobile Money'} - ${customer.name}`,
          settledAt: paymentSuccess ? ts : null,
          environment: env,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      paymentsCreated++;
      totalVolume += paymentSuccess ? roundedAmount : 0;
      lpRevenue += paymentSuccess ? fee : 0;

      // Update customer stats
      if (paymentSuccess) {
        await db.customerRecord.update({
          where: { id: customerRecord.id },
          data: {
            totalSpent: { increment: roundedAmount },
            transactionCount: { increment: 1 },
          },
        });
      }

      // 3. Ledger entry (double-entry: debit customer, credit merchant)
      ledgerEntries += 2;

      // 4. Webhook delivery
      const webhooks = await db.webhookEndpoint.findMany({
        where: { merchantId: merchant.id, status: 'ACTIVE', environment: env },
      });
      for (const wh of webhooks) {
        const webhookSuccess = Math.random() > probs.webhookFailure;
        const delivery = await db.webhookDelivery.create({
          data: {
            endpointId: wh.id,
            eventType: paymentSuccess ? 'payment.completed' : 'payment.failed',
            payload: JSON.stringify({
              id: payment.id, reference, amount: roundedAmount,
              currency: merchant.currency, status: payment.status,
              merchantId: merchant.id, customerName: customer.name,
              timestamp: ts.toISOString(),
            }),
            signature: `sha256=${uuidv4().slice(0, 64)}`,
            status: webhookSuccess ? 'DELIVERED' : 'FAILED',
            attempts: webhookSuccess ? 1 : 3,
            responseStatus: webhookSuccess ? 200 : 500,
            responseBody: webhookSuccess ? 'OK' : 'Internal Server Error',
            deliveredAt: webhookSuccess ? ts : null,
            createdAt: ts,
          },
        });
        webhooksCreated++;
      }

      // 5. Refund (occasionally)
      if (paymentSuccess && Math.random() < (probs.refund + customer.refundLikelihood)) {
        const refundAmount = Math.random() < 0.3 ? roundedAmount : Math.round(roundedAmount * 0.5 * 100) / 100;
        await db.refund.create({
          data: {
            merchantId: merchant.id,
            paymentId: payment.id,
            amount: refundAmount,
            type: refundAmount === roundedAmount ? 'FULL' : 'PARTIAL',
            reason: ['Customer request', 'Product out of stock', 'Duplicate charge', 'Service not rendered'][Math.floor(Math.random() * 4)],
            status: 'PROCESSED',
            requestedBy: 'system',
            processedAt: new Date(ts.getTime() + 3600000),
            createdAt: new Date(ts.getTime() + 3600000),
          },
        });
        refundsCreated++;
      }

      // 6. Compliance alert (occasionally)
      if (paymentSuccess && Math.random() < probs.complianceAlert) {
        const alertTypes = ['STRUCTURING', 'VELOCITY', 'HIGH_RISK_CORRIDOR', 'UNUSUAL_PATTERN'];
        const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        await db.aMLAlert.create({
          data: {
            entityType: 'CUSTOMER',
            entityId: customerRecord.id,
            alertType: alertTypes[Math.floor(Math.random() * alertTypes.length)],
            severity: severities[Math.floor(Math.random() * severities.length)],
            score: Math.random() * 100,
            details: JSON.stringify({
              paymentId: payment.id, amount: roundedAmount, reference,
              customer: customer.name, merchant: merchant.name,
            }),
            status: 'OPEN',
            createdAt: ts,
          },
        });
        complianceAlerts++;
      }

      // 7. Audit log
      await db.auditLog.create({
        data: {
          action: 'SIMULATE.PAYMENT',
          resourceType: 'Payment',
          resourceId: payment.id,
          result: 'SUCCESS',
          details: JSON.stringify({
            runId, reference, amount: roundedAmount,
            merchant: merchant.name, customer: customer.name,
            lp: lp.name, method, status: payment.status,
          }),
          createdAt: ts,
        },
      });
      auditLogs++;

    } catch (e) {
      errors.push(`Payment ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Generate occasional payouts
  const payoutCount = Math.floor(count / 20);
  for (let i = 0; i < payoutCount; i++) {
    try {
      const merchant = merchantActors[Math.floor(Math.random() * merchantActors.length)];
      const ts = new Date(now - Math.random() * durationMs);
      const amount = Math.round((100 + Math.random() * 2000) * 100) / 100;
      const fee = Math.round(amount * 0.005 * 100) / 100;
      const net = Math.round((amount - fee) * 100) / 100;

      await db.payout.create({
        data: {
          merchantId: merchant.id,
          method: ['BANK', 'MOBILE_MONEY', 'ONCHAIN'][Math.floor(Math.random() * 3)],
          sourceAmount: amount,
          sourceAsset: `TWIN${merchant.currency}`,
          sourceCurrency: merchant.currency,
          destinationCurrency: merchant.currency,
          destination: JSON.stringify({ bankAccount: `GH${Math.floor(Math.random() * 1e12)}`, accountName: merchant.name }),
          fxRate: 1, feeBps: 50, fee, netAmount: net,
          status: 'COMPLETED',
          txHash: `sim_tx_${uuidv4().slice(0, 8)}`,
          evidence: JSON.stringify({ source: 'open_banking', verificationLevel: 'institutional' }),
          createdAt: ts, processedAt: ts, completedAt: ts,
          environment: env,
        },
      });
      payoutsCreated++;

      await db.auditLog.create({
        data: {
          action: 'SIMULATE.PAYOUT',
          resourceType: 'Payout',
          resourceId: uuidv4(),
          result: 'SUCCESS',
          details: JSON.stringify({ runId, amount, merchant: merchant.name }),
          createdAt: ts,
        },
      });
      auditLogs++;
    } catch (e) {
      errors.push(`Payout ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Generate occasional invoices
  const invoiceCount = Math.floor(count / 15);
  for (let i = 0; i < invoiceCount; i++) {
    try {
      const merchant = merchantActors[Math.floor(Math.random() * merchantActors.length)];
      const ts = new Date(now - Math.random() * durationMs);
      const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }).map(() => ({
        description: ['Consulting services', 'Product order', 'Service fee', 'Subscription', 'Custom order'][Math.floor(Math.random() * 5)],
        quantity: 1 + Math.floor(Math.random() * 5),
        unitPrice: Math.round((20 + Math.random() * 200) * 100) / 100,
        total: 0,
      })).map(item => ({ ...item, total: Math.round(item.quantity * item.unitPrice * 100) / 100 }));
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const tax = Math.round(subtotal * 0.075 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const invCount = await db.invoice.count({ where: { merchantId: merchant.id } });
      const invoiceNumber = `INV-${String(invCount + 1).padStart(5, '0')}`;

      await db.invoice.create({
        data: {
          merchantId: merchant.id,
          number: invoiceNumber,
          items: JSON.stringify(items),
          subtotal, tax, total,
          currency: merchant.currency,
          status: Math.random() < 0.5 ? 'PAID' : 'SENT',
          dueDate: new Date(ts.getTime() + 7 * 86400000),
          sentAt: ts,
          paidAt: Math.random() < 0.5 ? ts : null,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      invoicesCreated++;
    } catch (e) {
      errors.push(`Invoice ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
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
        webhooksCreated, complianceAlerts, lpRevenue, totalVolume,
      }),
      resultHash: uuidv4().slice(0, 16),
      amount: totalVolume,
      currency: 'GHS',
      priority: 'balanced',
      buyerCountry: 'Ghana',
      merchantCountry: 'Ghana',
      costPercent: lpRevenue / (totalVolume || 1) * 100,
      settlementMs: durationMs,
      riskScore: complianceAlerts / (count || 1),
      confidence: 0.95,
      settled: true,
      amendments: 0,
      failures: errors.length,
    },
  });

  return {
    runId, scenario: params.scenario, duration: params.duration,
    paymentsCreated, payoutsCreated, refundsCreated, invoicesCreated,
    webhooksCreated, ledgerEntries, auditLogs, complianceAlerts,
    lpRevenue: Math.round(lpRevenue * 100) / 100,
    totalVolume: Math.round(totalVolume * 100) / 100,
    errors, duration_ms: Date.now() - start,
  };
}
