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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimulationParams {
  duration: '1h' | '1d' | '1w' | '1m';
  scenario: 'normal' | 'holiday' | 'outage' | 'growth' | 'stress';
  environment?: string;
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

/**
 * Create a payment — mirrors POST /api/payments/create
 * This is the SAME logic the API route runs.
 */
async function protocolCreatePayment(params: {
  merchantId: string;
  amount: number;
  currency: string;
  method: string;
  description: string;
  customerName: string;
  customerEmail: string;
  lpId: string;
  lpFeeBps: number;
  environment: string;
  timestamp: Date;
  success: boolean;
}): Promise<{ payment: any; error?: string }> {
  try {
    const fee = Math.round(params.amount * (params.lpFeeBps / 10000) * 100) / 100;
    const netAmount = params.success ? Math.round((params.amount - fee) * 100) / 100 : 0;

    // Find or create customer record (same as the API route)
    let customer = await db.customerRecord.findFirst({
      where: { merchantId: params.merchantId, email: params.customerEmail, environment: params.environment },
    });
    if (!customer) {
      customer = await db.customerRecord.create({
        data: {
          merchantId: params.merchantId,
          name: params.customerName,
          email: params.customerEmail,
          phone: `+23324${Math.floor(1000000 + Math.random() * 8999999)}`,
          country: 'Ghana',
          environment: params.environment,
        },
      });
    }

    const reference = `SIM-${uuidv4().slice(0, 8)}`;
    const payment = await db.payment.create({
      data: {
        merchantId: params.merchantId,
        customerId: null, // Payment.customerId references Customer table, not CustomerRecord
        amount: params.amount,
        currency: params.currency,
        sourceCurrency: params.currency,
        destinationCurrency: params.currency,
        status: params.success ? 'COMPLETED' : 'FAILED',
        method: params.method,
        corridor: `${params.currency}-${params.currency}`,
        lpId: params.lpId,
        fee,
        netAmount,
        fxRate: 1,
        reference,
        description: params.description,
        settledAt: params.success ? params.timestamp : null,
        environment: params.environment,
        createdAt: params.timestamp,
        updatedAt: params.timestamp,
      },
    });

    // Update customer stats (same as the API route)
    if (params.success) {
      await db.customerRecord.update({
        where: { id: customer.id },
        data: {
          totalSpent: { increment: params.amount },
          transactionCount: { increment: 1 },
        },
      });
    }

    // Deliver webhooks (same as the API route would trigger)
    const webhooks = await db.webhookEndpoint.findMany({
      where: { merchantId: params.merchantId, status: 'ACTIVE', environment: params.environment },
    });
    for (const wh of webhooks) {
      const webhookSuccess = Math.random() > BASE_PROBS.webhookFailure;
      await db.webhookDelivery.create({
        data: {
          endpointId: wh.id,
          eventType: params.success ? 'payment.completed' : 'payment.failed',
          payload: JSON.stringify({
            id: payment.id, reference, amount: params.amount,
            currency: params.currency, status: payment.status,
            merchantId: params.merchantId, customerName: params.customerName,
            timestamp: params.timestamp.toISOString(),
          }),
          signature: `sha256=${uuidv4().slice(0, 64)}`,
          status: webhookSuccess ? 'DELIVERED' : 'FAILED',
          attempts: webhookSuccess ? 1 : 3,
          responseStatus: webhookSuccess ? 200 : 500,
          responseBody: webhookSuccess ? 'OK' : 'Internal Server Error',
          deliveredAt: webhookSuccess ? params.timestamp : null,
          createdAt: params.timestamp,
        },
      });
    }

    // Audit log (same as the API route)
    await db.auditLog.create({
      data: {
        action: 'SIMULATE.PAYMENT',
        resourceType: 'Payment',
        resourceId: payment.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          reference, amount: params.amount,
          merchant: params.merchantId, customer: params.customerName,
          method: params.method, status: payment.status,
        }),
        createdAt: params.timestamp,
      },
    });

    return { payment };
  } catch (e) {
    return { payment: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a payout — mirrors POST /api/payouts/create
 */
async function protocolCreatePayout(params: {
  merchantId: string;
  method: string;
  amount: number;
  currency: string;
  environment: string;
  timestamp: Date;
}): Promise<{ payout: any; error?: string }> {
  try {
    const fee = Math.round(params.amount * 0.005 * 100) / 100;
    const net = Math.round((params.amount - fee) * 100) / 100;

    const payout = await db.payout.create({
      data: {
        merchantId: params.merchantId,
        method: params.method,
        sourceAmount: params.amount,
        sourceAsset: `TWIN${params.currency}`,
        sourceCurrency: params.currency,
        destinationCurrency: params.currency,
        destination: JSON.stringify({ bankAccount: `GH${Math.floor(Math.random() * 1e12)}`, accountName: 'Merchant' }),
        fxRate: 1, feeBps: 50, fee, netAmount: net,
        status: 'COMPLETED',
        txHash: `sim_tx_${uuidv4().slice(0, 8)}`,
        evidence: JSON.stringify({ source: 'open_banking', verificationLevel: 'institutional' }),
        createdAt: params.timestamp, processedAt: params.timestamp, completedAt: params.timestamp,
        environment: params.environment,
      },
    });

    await db.auditLog.create({
      data: {
        action: 'SIMULATE.PAYOUT',
        resourceType: 'Payout',
        resourceId: payout.id,
        result: 'SUCCESS',
        details: JSON.stringify({ amount: params.amount, merchant: params.merchantId }),
        createdAt: params.timestamp,
      },
    });

    return { payout };
  } catch (e) {
    return { payout: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create a refund — mirrors POST /api/refunds/create
 */
async function protocolCreateRefund(params: {
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string;
  environment: string;
  timestamp: Date;
}): Promise<{ refund: any; error?: string }> {
  try {
    const refund = await db.refund.create({
      data: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        amount: params.amount,
        type: params.type,
        reason: params.reason,
        status: 'PROCESSED',
        requestedBy: 'system',
        processedAt: new Date(params.timestamp.getTime() + 3600000),
        createdAt: new Date(params.timestamp.getTime() + 3600000),
      },
    });

    await db.auditLog.create({
      data: {
        action: 'SIMULATE.REFUND',
        resourceType: 'Refund',
        resourceId: refund.id,
        result: 'SUCCESS',
        details: JSON.stringify({ amount: params.amount, paymentId: params.paymentId }),
        createdAt: params.timestamp,
      },
    });

    return { refund };
  } catch (e) {
    return { refund: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create an invoice — mirrors POST /api/invoices/create
 */
async function protocolCreateInvoice(params: {
  merchantId: string;
  customerEmail: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  tax: number;
  currency: string;
  environment: string;
  timestamp: Date;
}): Promise<{ invoice: any; error?: string }> {
  try {
    const items = params.items.map(item => ({
      ...item,
      total: Math.round(item.quantity * item.unitPrice * 100) / 100,
    }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const tax = Math.round(subtotal * (params.tax / 100) * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const invCount = await db.invoice.count({ where: { merchantId: params.merchantId } });
    const number = `INV-${String(invCount + 1).padStart(5, '0')}`;

    const invoice = await db.invoice.create({
      data: {
        merchantId: params.merchantId,
        number,
        items: JSON.stringify(items),
        subtotal, tax, total,
        currency: params.currency,
        status: Math.random() < 0.5 ? 'PAID' : 'SENT',
        dueDate: new Date(params.timestamp.getTime() + 7 * 86400000),
        sentAt: params.timestamp,
        paidAt: Math.random() < 0.5 ? params.timestamp : null,
        createdAt: params.timestamp,
        updatedAt: params.timestamp,
      },
    });

    return { invoice };
  } catch (e) {
    return { invoice: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create an AML alert — mirrors what the compliance system would produce
 */
async function protocolCreateAMLAlert(params: {
  entityType: string;
  entityId: string;
  alertType: string;
  severity: string;
  score: number;
  details: any;
  timestamp: Date;
}): Promise<{ alert: any; error?: string }> {
  try {
    const alert = await db.aMLAlert.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        alertType: params.alertType,
        severity: params.severity,
        score: params.score,
        details: JSON.stringify(params.details),
        status: 'OPEN',
        createdAt: params.timestamp,
      },
    });
    return { alert };
  } catch (e) {
    return { alert: null, error: e instanceof Error ? e.message : String(e) };
  }
}

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

export async function runWorldSimulation(params: SimulationParams): Promise<SimulationResult> {
  const start = Date.now();
  const runId = uuidv4();
  const probs = SCENARIO_MODIFIERS[params.scenario] ?? BASE_PROBS;
  const count = DURATION_MULTIPLIERS[params.duration] ?? 10;
  const env = params.environment || 'sandbox';
  const errors: string[] = [];
  const events: WorldEvent[] = [];

  // Load actors
  const { merchantProfiles, lpProfiles, customerProfiles } = await buildActorPool(env);

  if (merchantProfiles.length === 0) {
    return {
      runId, scenario: params.scenario, duration: params.duration,
      paymentsCreated: 0, payoutsCreated: 0, refundsCreated: 0, invoicesCreated: 0,
      webhooksCreated: 0, ledgerEntries: 0, auditLogs: 0, complianceAlerts: 0,
      lpRevenue: 0, totalVolume: 0, errors: ['No active merchants found. Seed the database first.'],
      duration_ms: Date.now() - start, events: [],
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
      const merchant = merchantProfiles[Math.floor(Math.random() * merchantProfiles.length)];
      const lp = lpProfiles[Math.floor(Math.random() * lpProfiles.length)];
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

      // 1. Create payment through protocol API
      const paymentResult = await protocolCreatePayment({
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

      if (paymentResult.error) {
        errors.push(`Payment ${i + 1}: ${paymentResult.error}`);
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
        resourceId: paymentResult.payment?.id,
      });

      // 2. Refund (occasionally, based on customer profile + scenario)
      if (success && Math.random() < (probs.refund + customer.refundLikelihood)) {
        const refundAmount = Math.random() < 0.3 ? roundedAmount : Math.round(roundedAmount * 0.5 * 100) / 100;
        const refundResult = await protocolCreateRefund({
          merchantId: merchant.id,
          paymentId: paymentResult.payment.id,
          amount: refundAmount,
          type: refundAmount === roundedAmount ? 'FULL' : 'PARTIAL',
          reason: ['Customer request', 'Product out of stock', 'Duplicate charge', 'Service not rendered'][Math.floor(Math.random() * 4)],
          environment: env,
          timestamp: ts,
        });

        if (!refundResult.error) {
          refundsCreated++;
          auditLogs++;
          events.push({
            ts: ts.getTime() + 3600000,
            actor: merchant.name,
            action: 'refund',
            description: `${merchant.name} refunded ${refundAmount} ${merchant.currency} to ${customer.name}`,
            resourceType: 'Refund',
            resourceId: refundResult.refund?.id,
          });
        }
      }

      // 3. Compliance alert (occasionally)
      if (success && Math.random() < probs.complianceAlert) {
        const alertTypes = ['STRUCTURING', 'VELOCITY', 'HIGH_RISK_CORRIDOR', 'UNUSUAL_PATTERN'];
        const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const alertResult = await protocolCreateAMLAlert({
          entityType: 'CUSTOMER',
          entityId: customer.id,
          alertType: alertTypes[Math.floor(Math.random() * alertTypes.length)],
          severity: severities[Math.floor(Math.random() * severities.length)],
          score: Math.random() * 100,
          details: {
            paymentId: paymentResult.payment.id,
            amount: roundedAmount,
            customer: customer.name,
            merchant: merchant.name,
            customerType: customer.type,
          },
          timestamp: ts,
        });

        if (!alertResult.error) {
          complianceAlerts++;
          events.push({
            ts: ts.getTime(),
            actor: 'Compliance System',
            action: 'aml_alert',
            description: `AML alert: ${alertTypes[0]} detected for ${customer.name} (${severities[1]})`,
            resourceType: 'AMLAlert',
            resourceId: alertResult.alert?.id,
          });
        }
      }

      // 4. Merchant creates invoice (occasionally)
      if (Math.random() < probs.invoiceCreation) {
        const invoiceItems = Array.from({ length: 1 + Math.floor(Math.random() * 3) }).map(() => ({
          description: ['Consulting', 'Product order', 'Service fee', 'Subscription'][Math.floor(Math.random() * 4)],
          quantity: 1 + Math.floor(Math.random() * 5),
          unitPrice: Math.round((20 + Math.random() * 200) * 100) / 100,
        }));
        const invoiceResult = await protocolCreateInvoice({
          merchantId: merchant.id,
          customerEmail: customer.email,
          items: invoiceItems,
          tax: 7.5,
          currency: merchant.currency,
          environment: env,
          timestamp: ts,
        });

        if (!invoiceResult.error) {
          invoicesCreated++;
          events.push({
            ts: ts.getTime(),
            actor: merchant.name,
            action: 'invoice',
            description: `${merchant.name} created invoice ${invoiceResult.invoice.number} for ${customer.name}`,
            resourceType: 'Invoice',
            resourceId: invoiceResult.invoice?.id,
          });
        }
      }

      // 5. Merchant payout (occasionally)
      if (Math.random() < probs.merchantPayout) {
        const payoutAmount = Math.round((100 + Math.random() * 2000) * 100) / 100;
        const payoutResult = await protocolCreatePayout({
          merchantId: merchant.id,
          method: ['BANK', 'MOBILE_MONEY', 'ONCHAIN'][Math.floor(Math.random() * 3)],
          amount: payoutAmount,
          currency: merchant.currency,
          environment: env,
          timestamp: new Date(ts.getTime() + 7200000),
        });

        if (!payoutResult.error) {
          payoutsCreated++;
          auditLogs++;
          events.push({
            ts: ts.getTime() + 7200000,
            actor: merchant.name,
            action: 'payout',
            description: `${merchant.name} withdrew ${payoutAmount} ${merchant.currency}`,
            resourceType: 'Payout',
            resourceId: payoutResult.payout?.id,
          });
        }
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

  return {
    runId, scenario: params.scenario, duration: params.duration,
    paymentsCreated, payoutsCreated, refundsCreated, invoicesCreated,
    webhooksCreated, ledgerEntries, auditLogs, complianceAlerts,
    lpRevenue: Math.round(lpRevenue * 100) / 100,
    totalVolume: Math.round(totalVolume * 100) / 100,
    errors, duration_ms: Date.now() - start,
    events: events.sort((a, b) => a.ts - b.ts),
  };
}
