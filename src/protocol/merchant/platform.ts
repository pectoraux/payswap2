/**
 * PaySwap Protocol — Merchant Platform.
 *
 * The Merchant Platform is the full merchant surface area on top of the
 * frozen kernel + protocol layer. It owns:
 *
 *   - Merchant onboarding → verification → bond escrow (state machine)
 *   - API key issuance / revocation (HMAC-scoped credentials)
 *   - Product catalog (price + metadata)
 *   - Customer registry (per merchant)
 *   - Invoice lifecycle (draft → sent → paid → disputed)
 *   - Refund lifecycle (requested → approved/rejected → processed)
 *   - Team member invitations (role-based)
 *   - Webhook endpoint setup (delegated to webhookEngine)
 *   - Analytics (revenue, AOV, refund rate, top customers)
 *
 * It bridges into the merchantRegistry (for tier/bond tracking) and the
 * webhookEngine (for endpoint registration + delivery). Merchant balances
 * in TWIN tokens live in the twinTokenEngine under holder key
 * `merchant:${merchantId}` and are queried via this platform.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/*`,
 * `@/protocol/merchant-registry`, and `@/protocol/webhooks/engine`.
 */
import { uid, round, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { merchantRegistry, type MerchantTier } from '@/protocol/merchant-registry';
import { webhookEngine } from '@/protocol/webhooks/engine';
import { DEFAULT_WEBHOOK_EVENTS } from '@/protocol/webhooks/engine';

// -------------------------------------------------------------- types
export type MerchantState = 'pending' | 'verified' | 'active' | 'suspended' | 'closed';

export interface TeamMember {
  id: string;
  merchantId: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'analyst';
  invitedAt: number;
  acceptedAt: number | null;
  status: 'invited' | 'active' | 'revoked';
}

export interface ApiKey {
  id: string;
  merchantId: string;
  label: string;
  key: string;            // psk_live_xxx — shown once on creation
  keyPrefix: string;      // psk_live_xxxx****
  scopes: string[];
  active: boolean;
  createdAt: number;
  revokedAt: number | null;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: number;
}

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export type InvoiceState = 'draft' | 'sent' | 'paid' | 'disputed' | 'void';

export interface Invoice {
  id: string;
  merchantId: string;
  customerId: string;
  number: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  dueDate: number;
  state: InvoiceState;
  paymentId?: string;
  createdAt: number;
  sentAt: number | null;
  paidAt: number | null;
}

export interface Customer {
  id: string;
  merchantId: string;
  name: string;
  email: string;
  phone?: string;
  lifetimeValue: number;
  transactionCount: number;
  createdAt: number;
}

export type RefundState = 'requested' | 'approved' | 'rejected' | 'processed' | 'failed';

export interface Refund {
  id: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;
  state: RefundState;
  createdAt: number;
  processedAt: number | null;
}

export interface MerchantSettings {
  defaultCurrency: string;
  payoutCurrency: string;
  statementDescriptor: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookEvents: string[];
  businessType: string;
  industry: string;
  supportEmail: string;
}

export interface MerchantAnalytics {
  merchantId: string;
  revenue: number;
  transactions: number;
  aov: number;              // average order value
  refundRate: number;       // refunds / transactions
  refundVolume: number;
  topCustomers: { customerId: string; name: string; lifetimeValue: number; transactionCount: number }[];
  currency: string;
  asOf: number;
}

export interface MerchantAccount {
  id: string;
  name: string;
  email: string;
  country: string;
  currency: string;
  state: MerchantState;
  tier: MerchantTier;
  bond: number;
  bondEscrowed: number;
  createdAt: number;
  verifiedAt: number | null;
  suspendedAt: number | null;
  suspensionReason: string | null;
  settings: MerchantSettings;
  revenue: number;
  transactionCount: number;
  refundVolume: number;
}

export const DEFAULT_API_KEY_SCOPES: string[] = [
  'payments:write',
  'payments:read',
  'webhooks:read',
];

export const DEFAULT_WEBHOOK_EVENT_TYPES: string[] = [...DEFAULT_WEBHOOK_EVENTS];

// -------------------------------------------------------------- class
export class MerchantPlatform {
  private merchants = new Map<string, MerchantAccount>();
  private apiKeys: ApiKey[] = [];
  private team: TeamMember[] = [];
  private products = new Map<string, Product>();
  private invoices = new Map<string, Invoice>();
  private customers = new Map<string, Customer>();
  private refunds = new Map<string, Refund>();
  private payments: { id: string; merchantId: string; customerId: string; amount: number; currency: string; createdAt: number }[] = [];
  private invoiceCounter = 0;

  // ----------------------------------------------------------- onboard
  onboard(params: { name: string; email: string; country: string; currency: string }): MerchantAccount {
    const id = uid('mch');
    const settings: MerchantSettings = {
      defaultCurrency: params.currency,
      payoutCurrency: params.currency,
      statementDescriptor: params.name.slice(0, 22),
      webhookUrl: null,
      webhookSecret: null,
      webhookEvents: [...DEFAULT_WEBHOOK_EVENT_TYPES],
      businessType: 'individual',
      industry: 'general',
      supportEmail: params.email,
    };
    const account: MerchantAccount = {
      id,
      name: params.name,
      email: params.email,
      country: params.country,
      currency: params.currency,
      state: 'pending',
      tier: 'unverified',
      bond: 0,
      bondEscrowed: 0,
      createdAt: nowTs(),
      verifiedAt: null,
      suspendedAt: null,
      suspensionReason: null,
      settings,
      revenue: 0,
      transactionCount: 0,
      refundVolume: 0,
    };
    this.merchants.set(id, account);
    // Mirror into the kernel-backed merchant registry (tier/bond tracking).
    merchantRegistry.register(id, params.name, params.country, params.currency, 0);
    eventEngine.emit('merchant.onboarded', {
      merchantId: id,
      name: params.name,
      email: params.email,
      country: params.country,
      currency: params.currency,
      state: 'pending',
      tier: 'unverified',
    }, 0);
    return account;
  }

  // ----------------------------------------------------------- verify
  verify(merchantId: string, bond: number): MerchantAccount | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const safeBond = Math.max(0, round(bond, 6));
    m.bond = safeBond;
    m.bondEscrowed = safeBond;
    m.state = safeBond >= 1000 ? 'active' : 'verified';
    m.verifiedAt = nowTs();
    merchantRegistry.upgradeTier(merchantId, safeBond);
    const registry = merchantRegistry.get(merchantId);
    if (registry) m.tier = registry.tier;
    eventEngine.emit('merchant.verified', {
      merchantId,
      bond: safeBond,
      state: m.state,
      tier: m.tier,
    }, 0);
    return m;
  }

  // ------------------------------------------------------ createApiKey
  createApiKey(merchantId: string, label: string, scopes?: string[]): ApiKey | null {
    if (!this.merchants.has(merchantId)) return null;
    const id = uid('psk_id');
    const raw = uid('psk_live');
    const key = `psk_live_${raw}`;
    const apiKey: ApiKey = {
      id,
      merchantId,
      label,
      key,
      keyPrefix: `${key.slice(0, 14)}****`,
      scopes: scopes && scopes.length > 0 ? [...scopes] : [...DEFAULT_API_KEY_SCOPES],
      active: true,
      createdAt: nowTs(),
      revokedAt: null,
    };
    this.apiKeys.push(apiKey);
    eventEngine.emit('merchant.api_key_created', {
      merchantId, keyId: id, label, scopes: apiKey.scopes,
    }, 0);
    return apiKey;
  }

  // ------------------------------------------------------ revokeApiKey
  revokeApiKey(merchantId: string, keyId: string): boolean {
    const k = this.apiKeys.find((x) => x.id === keyId && x.merchantId === merchantId);
    if (!k || !k.active) return false;
    k.active = false;
    k.revokedAt = nowTs();
    return true;
  }

  // ------------------------------------------------------- createProduct
  createProduct(merchantId: string, params: { name: string; description: string; price: number; currency: string; metadata?: Record<string, unknown> }): Product | null {
    if (!this.merchants.has(merchantId)) return null;
    const id = uid('prod');
    const product: Product = {
      id, merchantId,
      name: params.name,
      description: params.description,
      price: round(params.price, 6),
      currency: params.currency,
      metadata: params.metadata ?? {},
      active: true,
      createdAt: nowTs(),
    };
    this.products.set(id, product);
    eventEngine.emit('merchant.product_created', { merchantId, productId: id, name: params.name, price: product.price, currency: params.currency }, 0);
    return product;
  }

  // ------------------------------------------------------ createInvoice
  createInvoice(merchantId: string, params: { customerId: string; items: InvoiceItem[]; tax?: number; currency: string; dueDate: number }): Invoice | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    if (!this.customers.has(params.customerId) || this.customers.get(params.customerId)?.merchantId !== merchantId) {
      return null;
    }
    this.invoiceCounter += 1;
    const number = `INV-${this.invoiceCounter.toString().padStart(5, '0')}`;
    const subtotal = round(params.items.reduce((s, i) => s + i.amount, 0), 6);
    const tax = round(params.tax ?? 0, 6);
    const total = round(subtotal + tax, 6);
    const id = uid('inv');
    const invoice: Invoice = {
      id, merchantId,
      customerId: params.customerId,
      number,
      items: params.items,
      subtotal, tax, total,
      currency: params.currency,
      dueDate: params.dueDate,
      state: 'draft',
      createdAt: nowTs(),
      sentAt: null,
      paidAt: null,
    };
    this.invoices.set(id, invoice);
    eventEngine.emit('merchant.invoice_created', { merchantId, invoiceId: id, number, total, currency: params.currency, customerId: params.customerId }, 0);
    return invoice;
  }

  // ---------------------------------------------------------- sendInvoice
  sendInvoice(invoiceId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.state !== 'draft') return null;
    inv.state = 'sent';
    inv.sentAt = nowTs();
    eventEngine.emit('merchant.invoice_sent', { merchantId: inv.merchantId, invoiceId, number: inv.number, total: inv.total }, 0);
    return inv;
  }

  // ---------------------------------------------------------- payInvoice
  payInvoice(invoiceId: string, paymentId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.state !== 'sent') return null;
    inv.state = 'paid';
    inv.paymentId = paymentId;
    inv.paidAt = nowTs();
    const m = this.merchants.get(inv.merchantId);
    if (m) {
      m.revenue = round(m.revenue + inv.total, 6);
      m.transactionCount += 1;
    }
    const c = this.customers.get(inv.customerId);
    if (c) {
      c.lifetimeValue = round(c.lifetimeValue + inv.total, 6);
      c.transactionCount += 1;
    }
    this.payments.push({ id: paymentId, merchantId: inv.merchantId, customerId: inv.customerId, amount: inv.total, currency: inv.currency, createdAt: nowTs() });
    eventEngine.emit('merchant.invoice_paid', { merchantId: inv.merchantId, invoiceId, paymentId, amount: inv.total, currency: inv.currency }, 0);
    return inv;
  }

  // ------------------------------------------------------- createCustomer
  createCustomer(merchantId: string, params: { name: string; email: string; phone?: string }): Customer | null {
    if (!this.merchants.has(merchantId)) return null;
    const id = uid('cust');
    const customer: Customer = {
      id, merchantId,
      name: params.name,
      email: params.email,
      phone: params.phone,
      lifetimeValue: 0,
      transactionCount: 0,
      createdAt: nowTs(),
    };
    this.customers.set(id, customer);
    return customer;
  }

  // -------------------------------------------------------- createRefund
  createRefund(merchantId: string, paymentId: string, amount: number, currency: string, reason: string): Refund | null {
    if (!this.merchants.has(merchantId)) return null;
    const id = uid('rfnd');
    const refund: Refund = {
      id, merchantId, paymentId,
      amount: round(amount, 6),
      currency,
      reason,
      state: 'requested',
      createdAt: nowTs(),
      processedAt: null,
    };
    this.refunds.set(id, refund);
    eventEngine.emit('merchant.refund_requested', { merchantId, refundId: id, paymentId, amount, currency, reason }, 0);
    return refund;
  }

  // ------------------------------------------------------- processRefund
  processRefund(refundId: string, approved: boolean): Refund | null {
    const r = this.refunds.get(refundId);
    if (!r || r.state !== 'requested') return null;
    if (!approved) {
      r.state = 'rejected';
      r.processedAt = nowTs();
      eventEngine.emit('merchant.refund_rejected', { merchantId: r.merchantId, refundId }, 0);
      return r;
    }
    r.state = 'processed';
    r.processedAt = nowTs();
    const m = this.merchants.get(r.merchantId);
    if (m) {
      m.refundVolume = round(m.refundVolume + r.amount, 6);
    }
    eventEngine.emit('merchant.refund_processed', { merchantId: r.merchantId, refundId, amount: r.amount, currency: r.currency }, 0);
    return r;
  }

  // --------------------------------------------------------- setupWebhook
  setupWebhook(merchantId: string, url: string, events?: string[]): { endpointId: string; secret: string } | null {
    if (!this.merchants.has(merchantId)) return null;
    const ep = webhookEngine.register({ merchantId, url, events });
    const m = this.merchants.get(merchantId)!;
    m.settings.webhookUrl = url;
    m.settings.webhookSecret = ep.secret;
    m.settings.webhookEvents = [...ep.events];
    eventEngine.emit('merchant.webhook_setup', { merchantId, endpointId: ep.id, url, events: ep.events }, 0);
    return { endpointId: ep.id, secret: ep.secret };
  }

  // ----------------------------------------------------------- getAnalytics
  getAnalytics(merchantId: string): MerchantAnalytics | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const refundRate = m.transactionCount > 0 ? round(m.refundVolume / (m.revenue || 1), 4) : 0;
    const aov = m.transactionCount > 0 ? round(m.revenue / m.transactionCount, 6) : 0;
    const customers = [...this.customers.values()].filter((c) => c.merchantId === merchantId);
    const topCustomers = customers
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .slice(0, 5)
      .map((c) => ({ customerId: c.id, name: c.name, lifetimeValue: c.lifetimeValue, transactionCount: c.transactionCount }));
    return {
      merchantId,
      revenue: m.revenue,
      transactions: m.transactionCount,
      aov,
      refundRate,
      refundVolume: m.refundVolume,
      topCustomers,
      currency: m.currency,
      asOf: nowTs(),
    };
  }

  // ---------------------------------------------------- inviteTeamMember
  inviteTeamMember(merchantId: string, email: string, role: TeamMember['role']): TeamMember | null {
    if (!this.merchants.has(merchantId)) return null;
    const member: TeamMember = {
      id: uid('tm'),
      merchantId, email, role,
      invitedAt: nowTs(),
      acceptedAt: null,
      status: 'invited',
    };
    this.team.push(member);
    eventEngine.emit('merchant.team_invited', { merchantId, teamMemberId: member.id, email, role }, 0);
    return member;
  }

  // -------------------------------------------------------------- suspend
  suspend(merchantId: string, reason: string): MerchantAccount | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    m.state = 'suspended';
    m.suspendedAt = nowTs();
    m.suspensionReason = reason;
    eventEngine.emit('merchant.suspended', { merchantId, reason }, 0);
    return m;
  }

  // -------------------------------------------------------------- getters
  getMerchant(merchantId: string): MerchantAccount | undefined {
    return this.merchants.get(merchantId);
  }

  getProducts(merchantId?: string): Product[] {
    if (!merchantId) return [...this.products.values()];
    return [...this.products.values()].filter((p) => p.merchantId === merchantId);
  }

  getInvoices(merchantId?: string): Invoice[] {
    if (!merchantId) return [...this.invoices.values()];
    return [...this.invoices.values()].filter((i) => i.merchantId === merchantId);
  }

  getCustomers(merchantId?: string): Customer[] {
    if (!merchantId) return [...this.customers.values()];
    return [...this.customers.values()].filter((c) => c.merchantId === merchantId);
  }

  getRefunds(merchantId?: string): Refund[] {
    if (!merchantId) return [...this.refunds.values()];
    return [...this.refunds.values()].filter((r) => r.merchantId === merchantId);
  }

  getApiKeys(merchantId: string): ApiKey[] {
    return this.apiKeys.filter((k) => k.merchantId === merchantId);
  }

  getTeam(merchantId: string): TeamMember[] {
    return this.team.filter((t) => t.merchantId === merchantId);
  }

  getPayments(merchantId?: string) {
    if (!merchantId) return [...this.payments];
    return this.payments.filter((p) => p.merchantId === merchantId);
  }

  allMerchants(): MerchantAccount[] {
    return [...this.merchants.values()];
  }

  // --------------------------------------------------------------- reset
  reset(): void {
    this.merchants.clear();
    this.apiKeys = [];
    this.team = [];
    this.products.clear();
    this.invoices.clear();
    this.customers.clear();
    this.refunds.clear();
    this.payments = [];
    this.invoiceCounter = 0;
  }
}

export const merchantPlatform = new MerchantPlatform();
