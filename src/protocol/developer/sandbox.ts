/**
 * PaySwap Protocol — Developer Platform — Sandbox Service.
 *
 * Provides isolated sandbox environments where developers can exercise the
 * full PaySwap API surface without touching live data or real-money
 * connectors.
 *
 * Each sandbox owns:
 *   - A unique `sandboxId` (opaque, prefixed `sbx_`).
 *   - The owning merchant (`merchantId`).
 *   - A pair of test API keys (`psk_test_...`) — one publishable, one secret.
 *   - An in-memory dataset of test customers, products, payments, and
 *     invoices that mirrors the shape of live data.
 *   - A simulated connector registry (Stellar testnet, M-Pesa sandbox,
 *     Stripe test, etc.) so end-to-end flows exercise the same code paths
 *     used in production.
 *
 * Lifecycle:
 *   - `createSandbox(merchantId)`         — provisions a fresh sandbox,
 *                                            issues test keys, and seeds the
 *                                            initial test dataset.
 *   - `resetSandbox(sandboxId)`           — wipes the dataset and re-seeds
 *                                            the initial test data. API keys
 *                                            and `sandboxId` are preserved.
 *   - `getSandbox(sandboxId)`             — read-only snapshot.
 *   - `listSandboxes(merchantId)`         — paginated list for a merchant.
 *   - `seedTestData(sandboxId)`           — adds another batch of test
 *                                            customers / products / payments
 *                                            on top of whatever already
 *                                            exists (idempotent-ish — the
 *                                            batch is fresh each call).
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`. No kernel files are modified.
 */
import { uid, nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Sandbox lifecycle states. */
export type SandboxState = 'active' | 'paused' | 'archived';

/** A test customer record in the sandbox dataset. */
export interface SandboxCustomer {
  id: string;
  sandboxId: string;
  name: string;
  email: string;
  phone?: string;
  country: string;
  createdAt: number;
}

/** A test product record in the sandbox dataset. */
export interface SandboxProduct {
  id: string;
  sandboxId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  sku: string;
  createdAt: number;
}

/** A test payment record in the sandbox dataset. */
export interface SandboxPayment {
  id: string;
  sandboxId: string;
  customerId: string;
  productId: string;
  amount: number;
  currency: string;
  method: 'card' | 'mpesa' | 'bank' | 'crypto';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  reference: string;
  createdAt: number;
}

/** A test invoice record in the sandbox dataset. */
export interface SandboxInvoice {
  id: string;
  sandboxId: string;
  customerId: string;
  number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
  dueAt: number;
  createdAt: number;
}

/** A simulated connector available in the sandbox. */
export interface SandboxConnector {
  id: string;
  name: string;
  mode: 'simulation';
  supportedMethods: string[];
  healthy: boolean;
}

/** A test API key issued for the sandbox. */
export interface SandboxApiKey {
  id: string;
  key: string;
  label: string;
  environment: 'test';
  scopes: string[];
  createdAt: number;
}

/** Complete sandbox snapshot. */
export interface Sandbox {
  id: string;
  merchantId: string;
  state: SandboxState;
  apiKeys: SandboxApiKey[];
  connectors: SandboxConnector[];
  customers: SandboxCustomer[];
  products: SandboxProduct[];
  payments: SandboxPayment[];
  invoices: SandboxInvoice[];
  createdAt: number;
  resetAt?: number;
  lastActivityAt: number;
}

/** Parameters for `seedTestData`. */
export interface SeedTestDataParams {
  /** Number of customers to seed (default 5). */
  customers?: number;
  /** Number of products to seed (default 8). */
  products?: number;
  /** Number of payments to seed (default 10). */
  payments?: number;
  /** Number of invoices to seed (default 4). */
  invoices?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Cryptographically-acceptable test-key suffix. */
function randomKeySuffix(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const buf = new Uint8Array(length);
  if (typeof globalThis === 'object' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < length; i++) out += chars[buf[i] % chars.length];
  } else {
    // Fallback — not for production use, sandboxes only.
    for (let i = 0; i < length; i++)
      out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Default simulated connectors registered with every new sandbox. */
function defaultConnectors(): SandboxConnector[] {
  return [
    {
      id: 'connector_stellar_testnet',
      name: 'Stellar Testnet',
      mode: 'simulation',
      supportedMethods: ['crypto'],
      healthy: true,
    },
    {
      id: 'connector_mpesa_sandbox',
      name: 'M-Pesa Sandbox',
      mode: 'simulation',
      supportedMethods: ['mpesa'],
      healthy: true,
    },
    {
      id: 'connector_stripe_test',
      name: 'Stripe Test',
      mode: 'simulation',
      supportedMethods: ['card'],
      healthy: true,
    },
    {
      id: 'connector_flutterwave_test',
      name: 'Flutterwave Test',
      mode: 'simulation',
      supportedMethods: ['card', 'bank'],
      healthy: true,
    },
  ];
}

/** Default test customers. */
const SEED_CUSTOMER_NAMES = [
  ['Alice Wanjiru', 'alice@example.com', '+254700000001', 'KE'],
  ['Bob Mwangi', 'bob@example.com', '+254700000002', 'KE'],
  ['Carol Otieno', 'carol@example.com', '+254700000003', 'KE'],
  ['David Kamau', 'david@example.com', '+254700000004', 'KE'],
  ['Eve Njeri', 'eve@example.com', '+254700000005', 'KE'],
  ['Frank Hassan', 'frank@example.com', '+254700000006', 'KE'],
  ['Grace Auma', 'grace@example.com', '+254700000007', 'KE'],
  ['Henry Onyango', 'henry@example.com', '+254700000008', 'KE'],
];

/** Default test products. */
const SEED_PRODUCT_NAMES: Array<[string, string, number, string]> = [
  ['Pro Plan', 'Monthly subscription to the Pro tier', 2900, 'KES'],
  ['Starter Plan', 'Entry-level monthly plan', 990, 'KES'],
  ['Enterprise Seat', 'Per-seat license for enterprise', 15000, 'KES'],
  ['API Boost Pack', 'Additional 100k API calls', 5000, 'KES'],
  ['One-time Setup', 'Professional services setup fee', 25000, 'KES'],
  ['USDC Top-up', 'Top up wallet with USDC', 100, 'USDC'],
  ['Premium Support', '24/7 priority support add-on', 7500, 'KES'],
  ['Custom Integration', 'Bespoke connector development', 80000, 'KES'],
];

const PAYMENT_METHODS: SandboxPayment['method'][] = ['card', 'mpesa', 'bank', 'crypto'];
const PAYMENT_STATUSES: SandboxPayment['status'][] = ['succeeded', 'succeeded', 'succeeded', 'pending', 'failed'];

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// SandboxService
// ---------------------------------------------------------------------------

/**
 * SandboxService owns the in-memory sandbox registry for the developer
 * platform. Sandboxes are not persisted — they exist for the lifetime of
 * the process and are rebuilt from seed data on demand.
 */
export class SandboxService {
  private sandboxes = new Map<string, Sandbox>();

  /**
   * Provision a fresh sandbox for a merchant. Issues a publishable + secret
   * test API key, registers the default simulated connectors, and seeds the
   * initial test dataset.
   */
  createSandbox(merchantId: string): Sandbox {
    if (!merchantId || typeof merchantId !== 'string') {
      throw new Error('merchantId is required');
    }
    const sandboxId = uid('sbx');
    const ts = nowTs();

    const secretKey: SandboxApiKey = {
      id: uid('key'),
      key: `psk_test_${randomKeySuffix()}`,
      label: 'Secret test key',
      environment: 'test',
      scopes: [
        'payments:read',
        'payments:write',
        'payouts:read',
        'payouts:write',
        'webhooks:read',
        'webhooks:write',
        'merchant:read',
        'merchant:write',
        'customers:read',
        'customers:write',
        'products:read',
        'products:write',
        'invoices:read',
        'invoices:write',
      ],
      createdAt: ts,
    };

    const publishableKey: SandboxApiKey = {
      id: uid('key'),
      key: `pk_test_${randomKeySuffix()}`,
      label: 'Publishable test key',
      environment: 'test',
      scopes: ['payments:read', 'payments:write'],
      createdAt: ts,
    };

    const sandbox: Sandbox = {
      id: sandboxId,
      merchantId,
      state: 'active',
      apiKeys: [secretKey, publishableKey],
      connectors: defaultConnectors(),
      customers: [],
      products: [],
      payments: [],
      invoices: [],
      createdAt: ts,
      lastActivityAt: ts,
    };

    this.sandboxes.set(sandboxId, sandbox);
    this.seedTestData(sandboxId, { customers: 5, products: 8, payments: 10, invoices: 4 });
    return this.getSandbox(sandboxId)!;
  }

  /**
   * Reset a sandbox: wipe the dataset and re-seed the initial test data.
   * The `sandboxId`, API keys, and connectors are preserved.
   */
  resetSandbox(sandboxId: string): Sandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`sandbox not found: ${sandboxId}`);
    sandbox.customers = [];
    sandbox.products = [];
    sandbox.payments = [];
    sandbox.invoices = [];
    sandbox.resetAt = nowTs();
    sandbox.lastActivityAt = sandbox.resetAt;
    // Re-seed the initial batch.
    this.seedTestData(sandboxId, { customers: 5, products: 8, payments: 10, invoices: 4 });
    return this.getSandbox(sandboxId)!;
  }

  /** Return a snapshot of a sandbox or `undefined` if not found. */
  getSandbox(sandboxId: string): Sandbox | undefined {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return undefined;
    // Shallow clone so callers can't mutate internal state.
    return {
      ...sandbox,
      apiKeys: [...sandbox.apiKeys],
      connectors: [...sandbox.connectors],
      customers: [...sandbox.customers],
      products: [...sandbox.products],
      payments: [...sandbox.payments],
      invoices: [...sandbox.invoices],
    };
  }

  /** List all sandboxes for a merchant. */
  listSandboxes(merchantId: string): Sandbox[] {
    const out: Sandbox[] = [];
    for (const sb of this.sandboxes.values()) {
      if (sb.merchantId === merchantId) out.push(this.getSandbox(sb.id)!);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Seed additional test data into a sandbox. Each call adds a fresh batch
   * on top of whatever already exists. This is the developer's "give me
   * more test data" hook.
   */
  seedTestData(sandboxId: string, params: SeedTestDataParams = {}): {
    customers: SandboxCustomer[];
    products: SandboxProduct[];
    payments: SandboxPayment[];
    invoices: SandboxInvoice[];
  } {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`sandbox not found: ${sandboxId}`);

    const customerCount = Math.max(0, params.customers ?? 5);
    const productCount = Math.max(0, params.products ?? 8);
    const paymentCount = Math.max(0, params.payments ?? 10);
    const invoiceCount = Math.max(0, params.invoices ?? 4);

    const ts = nowTs();
    const newCustomers: SandboxCustomer[] = [];
    const newProducts: SandboxProduct[] = [];
    const newPayments: SandboxPayment[] = [];
    const newInvoices: SandboxInvoice[] = [];

    // Customers.
    for (let i = 0; i < customerCount; i++) {
      const tpl = SEED_CUSTOMER_NAMES[i % SEED_CUSTOMER_NAMES.length];
      newCustomers.push({
        id: uid('cust_test'),
        sandboxId,
        name: tpl[0],
        email: `${tpl[1].split('@')[0]}_${ts.toString(36).slice(-4)}_${i}@${tpl[1].split('@')[1]}`,
        phone: tpl[2],
        country: tpl[3],
        createdAt: ts,
      });
    }
    sandbox.customers.push(...newCustomers);

    // Products.
    for (let i = 0; i < productCount; i++) {
      const tpl = SEED_PRODUCT_NAMES[i % SEED_PRODUCT_NAMES.length];
      newProducts.push({
        id: uid('prod_test'),
        sandboxId,
        name: tpl[0],
        description: tpl[1],
        price: tpl[2],
        currency: tpl[3],
        sku: `SKU-${(i + 1).toString().padStart(4, '0')}`,
        createdAt: ts,
      });
    }
    sandbox.products.push(...newProducts);

    // Payments (depends on customers + products).
    const allCustomers = sandbox.customers;
    const allProducts = sandbox.products;
    for (let i = 0; i < paymentCount; i++) {
      if (allCustomers.length === 0 || allProducts.length === 0) break;
      const cust = allCustomers[Math.floor(Math.random() * allCustomers.length)];
      const prod = allProducts[Math.floor(Math.random() * allProducts.length)];
      const method = PAYMENT_METHODS[Math.floor(Math.random() * PAYMENT_METHODS.length)];
      const status = PAYMENT_STATUSES[Math.floor(Math.random() * PAYMENT_STATUSES.length)];
      newPayments.push({
        id: uid('pay_test'),
        sandboxId,
        customerId: cust.id,
        productId: prod.id,
        amount: round2(prod.price * (0.5 + Math.random())),
        currency: prod.currency,
        method,
        status,
        reference: `REF-${ts.toString(36)}-${i}`,
        createdAt: ts,
      });
    }
    sandbox.payments.push(...newPayments);

    // Invoices.
    for (let i = 0; i < invoiceCount; i++) {
      if (allCustomers.length === 0) break;
      const cust = allCustomers[Math.floor(Math.random() * allCustomers.length)];
      const amount = round2(1000 + Math.random() * 50000);
      const dueAt = ts + 7 * 24 * 60 * 60 * 1000;
      const status: SandboxInvoice['status'] = i % 3 === 0 ? 'paid' : i % 3 === 1 ? 'sent' : 'draft';
      newInvoices.push({
        id: uid('inv_test'),
        sandboxId,
        customerId: cust.id,
        number: `INV-${ts.toString(36).toUpperCase()}-${i}`,
        amount,
        currency: 'KES',
        status,
        dueAt,
        createdAt: ts,
      });
    }
    sandbox.invoices.push(...newInvoices);

    sandbox.lastActivityAt = ts;
    return { customers: newCustomers, products: newProducts, payments: newPayments, invoices: newInvoices };
  }

  /** Pause a sandbox (no API calls accepted). */
  pauseSandbox(sandboxId: string): Sandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`sandbox not found: ${sandboxId}`);
    sandbox.state = 'paused';
    sandbox.lastActivityAt = nowTs();
    return this.getSandbox(sandboxId)!;
  }

  /** Resume a paused sandbox. */
  resumeSandbox(sandboxId: string): Sandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`sandbox not found: ${sandboxId}`);
    sandbox.state = 'active';
    sandbox.lastActivityAt = nowTs();
    return this.getSandbox(sandboxId)!;
  }

  /** Archive a sandbox (soft delete). */
  archiveSandbox(sandboxId: string): Sandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`sandbox not found: ${sandboxId}`);
    sandbox.state = 'archived';
    sandbox.lastActivityAt = nowTs();
    return this.getSandbox(sandboxId)!;
  }

  /** Total number of sandboxes registered (for ops/diagnostics). */
  count(): number {
    return this.sandboxes.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _g = globalThis as unknown as { __PAYSWAP_SANDBOX_SERVICE?: SandboxService };
export const sandboxService: SandboxService =
  _g.__PAYSWAP_SANDBOX_SERVICE ?? new SandboxService();
if (!_g.__PAYSWAP_SANDBOX_SERVICE) _g.__PAYSWAP_SANDBOX_SERVICE = sandboxService;
