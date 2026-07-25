/**
 * PaySwap Protocol — Merchant Platform.
 *
 * Complete merchant lifecycle: onboarding → verification → API keys →
 * products → invoices → checkout → refunds → customers → analytics → team.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { merchantRegistry, type MerchantTier } from '../merchant-registry';
import { webhookEngine } from '../webhooks/engine';

export type MerchantState = 'pending' | 'verified' | 'active' | 'suspended' | 'closed';
export type ProductState = 'active' | 'inactive' | 'archived';
export type InvoiceState = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type RefundState = 'pending' | 'approved' | 'completed' | 'denied';
export type Role = 'owner' | 'admin' | 'developer' | 'analyst' | 'viewer';

export interface MerchantAccount {
  id: string;
  name: string;
  email: string;
  country: string;
  currency: string;
  state: MerchantState;
  tier: MerchantTier;
  bond: number;
  apiKeys: ApiKey[];
  team: TeamMember[];
  settings: MerchantSettings;
  createdAt: number;
  verifiedAt: number | null;
}

export interface ApiKey {
  id: string;
  key: string;
  label: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  active: boolean;
}

export interface TeamMember {
  id: string;
  email: string;
  role: Role;
  invitedAt: number;
  joinedAt: number | null;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  state: ProductState;
  metadata: Record<string, string>;
  createdAt: number;
}

export interface Invoice {
  id: string;
  merchantId: string;
  customerId: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  state: InvoiceState;
  dueDate: number;
  createdAt: number;
  paidAt: number | null;
  paymentId: string | null;
}

export interface Customer {
  id: string;
  merchantId: string;
  name: string;
  email: string;
  phone: string;
  totalSpent: number;
  transactionCount: number;
  createdAt: number;
}

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
  webhookUrl: string | null;
  webhookSecret: string | null;
  checkoutTheme: 'light' | 'dark';
  logoUrl: string | null;
  autoSettle: boolean;
  settlementCurrency: string;
}

export interface MerchantAnalytics {
  totalRevenue: number;
  totalTransactions: number;
  averageOrderValue: number;
  refundRate: number;
  topCustomers: { customerId: string; name: string; totalSpent: number }[];
  revenueByDay: { date: string; revenue: number; count: number }[];
}

export class MerchantPlatform {
  private merchants: Map<string, MerchantAccount> = new Map();
  private products: Map<string, Product> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private customers: Map<string, Customer> = new Map();
  private refunds: Map<string, Refund> = new Map();

  /** Onboard a new merchant. */
  onboard(params: { name: string; email: string; country: string; currency: string }): MerchantAccount {
    const merchant: MerchantAccount = {
      id: uid('merchant'),
      name: params.name, email: params.email, country: params.country, currency: params.currency,
      state: 'pending', tier: 'unverified', bond: 0,
      apiKeys: [], team: [{
        id: uid('member'), email: params.email, role: 'owner',
        invitedAt: Date.now(), joinedAt: Date.now(),
      }],
      settings: {
        defaultCurrency: params.currency, webhookUrl: null, webhookSecret: null,
        checkoutTheme: 'light', logoUrl: null, autoSettle: true, settlementCurrency: params.currency,
      },
      createdAt: Date.now(), verifiedAt: null,
    };
    this.merchants.set(merchant.id, merchant);
    // Register in trust tier system
    merchantRegistry.register(merchant.id, params.name, params.country, params.currency, 0);
    eventEngine.emit('merchant.onboarded', { merchantId: merchant.id, name: params.name }, 0);
    return merchant;
  }

  /** Complete verification (KYC + bond). */
  verify(merchantId: string, bond: number): MerchantAccount | null {
    const m = this.merchants.get(merchantId);
    if (!m || m.state !== 'pending') return null;
    m.state = 'verified';
    m.bond = bond;
    m.verifiedAt = Date.now();
    // Upgrade tier based on bond
    merchantRegistry.upgradeTier(merchantId, bond);
    m.tier = merchantRegistry.get(merchantId)?.tier ?? 'unverified';
    // Auto-activate if bond sufficient
    if (bond >= 1000) m.state = 'active';
    eventEngine.emit('merchant.verified', { merchantId, bond, tier: m.tier }, 0);
    return m;
  }

  /** Generate an API key. */
  createApiKey(merchantId: string, label: string, scopes: string[] = ['payments:write', 'payments:read', 'webhooks:read']): ApiKey | null {
    const m = this.merchants.get(merchantId);
    if (!m || m.state !== 'active') return null;
    const apiKey: ApiKey = {
      id: uid('key'), key: `psk_${uid('live').replace(/_/g, '')}`, label,
      scopes, createdAt: Date.now(), lastUsedAt: null, active: true,
    };
    m.apiKeys.push(apiKey);
    eventEngine.emit('merchant.api_key_created', { merchantId, keyId: apiKey.id, label }, 0);
    return apiKey;
  }

  /** Revoke an API key. */
  revokeApiKey(merchantId: string, keyId: string): boolean {
    const m = this.merchants.get(merchantId);
    if (!m) return false;
    const key = m.apiKeys.find((k) => k.id === keyId);
    if (key) { key.active = false; return true; }
    return false;
  }

  /** Create a product. */
  createProduct(merchantId: string, params: { name: string; description: string; price: number; currency: string; metadata?: Record<string, string> }): Product | null {
    const m = this.merchants.get(merchantId);
    if (!m || m.state !== 'active') return null;
    const product: Product = {
      id: uid('prod'), merchantId,
      name: params.name, description: params.description,
      price: params.price, currency: params.currency,
      state: 'active', metadata: params.metadata ?? {},
      createdAt: Date.now(),
    };
    this.products.set(product.id, product);
    return product;
  }

  /** Create an invoice. */
  createInvoice(merchantId: string, params: {
    customerId: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    tax?: number;
    currency: string;
    dueDate: number;
  }): Invoice | null {
    const m = this.merchants.get(merchantId);
    if (!m || m.state !== 'active') return null;
    const items = params.items.map((item) => ({
      description: item.description, quantity: item.quantity,
      unitPrice: item.unitPrice, total: round(item.quantity * item.unitPrice, 2),
    }));
    const subtotal = round(items.reduce((s, i) => s + i.total, 0), 2);
    const tax = round(params.tax ?? 0, 2);
    const total = round(subtotal + tax, 2);
    const invoice: Invoice = {
      id: uid('inv'), merchantId, customerId: params.customerId,
      items, subtotal, tax, total, currency: params.currency,
      state: 'draft', dueDate: params.dueDate,
      createdAt: Date.now(), paidAt: null, paymentId: null,
    };
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  /** Send invoice (transitions to 'sent'). */
  sendInvoice(invoiceId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.state !== 'draft') return null;
    inv.state = 'sent';
    return inv;
  }

  /** Mark invoice as paid. */
  payInvoice(invoiceId: string, paymentId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.state !== 'sent') return null;
    inv.state = 'paid';
    inv.paidAt = Date.now();
    inv.paymentId = paymentId;
    // Update customer stats
    const customer = this.customers.get(inv.customerId);
    if (customer) {
      customer.totalSpent = round(customer.totalSpent + inv.total, 2);
      customer.transactionCount++;
    }
    return inv;
  }

  /** Create a customer. */
  createCustomer(merchantId: string, params: { name: string; email: string; phone: string }): Customer | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const customer: Customer = {
      id: uid('cust'), merchantId,
      name: params.name, email: params.email, phone: params.phone,
      totalSpent: 0, transactionCount: 0, createdAt: Date.now(),
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  /** Create a refund request. */
  createRefund(merchantId: string, paymentId: string, amount: number, currency: string, reason: string): Refund | null {
    const m = this.merchants.get(merchantId);
    if (!m || m.state !== 'active') return null;
    const refund: Refund = {
      id: uid('refund'), merchantId, paymentId, amount, currency, reason,
      state: 'pending', createdAt: Date.now(), processedAt: null,
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  /** Process a refund. */
  processRefund(refundId: string, approved: boolean): Refund | null {
    const r = this.refunds.get(refundId);
    if (!r || r.state !== 'pending') return null;
    r.state = approved ? 'completed' : 'denied';
    r.processedAt = Date.now();
    return r;
  }

  /** Register webhook for merchant. */
  setupWebhook(merchantId: string, url: string, events?: string[]): { secret: string } | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const endpoint = webhookEngine.register({ merchantId, url, events });
    m.settings.webhookUrl = url;
    m.settings.webhookSecret = endpoint.secret;
    return { secret: endpoint.secret };
  }

  /** Get merchant analytics. */
  getAnalytics(merchantId: string): MerchantAnalytics {
    const merchantInvoices = [...this.invoices.values()].filter((i) => i.merchantId === merchantId && i.state === 'paid');
    const totalRevenue = merchantInvoices.reduce((s, i) => s + i.total, 0);
    const totalTransactions = merchantInvoices.length;
    const refunds = [...this.refunds.values()].filter((r) => r.merchantId === merchantId && r.state === 'completed');
    const refundRate = totalTransactions > 0 ? refunds.length / totalTransactions : 0;

    const merchantCustomers = [...this.customers.values()].filter((c) => c.merchantId === merchantId);
    const topCustomers = merchantCustomers
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 5)
      .map((c) => ({ customerId: c.id, name: c.name, totalSpent: c.totalSpent }));

    return {
      totalRevenue: round(totalRevenue, 2),
      totalTransactions,
      averageOrderValue: totalTransactions > 0 ? round(totalRevenue / totalTransactions, 2) : 0,
      refundRate: round(refundRate, 4),
      topCustomers,
      revenueByDay: [],
    };
  }

  /** Invite team member. */
  inviteTeamMember(merchantId: string, email: string, role: Role): TeamMember | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    const member: TeamMember = { id: uid('member'), email, role, invitedAt: Date.now(), joinedAt: null };
    m.team.push(member);
    return member;
  }

  /** Suspend merchant. */
  suspend(merchantId: string, reason: string): MerchantAccount | null {
    const m = this.merchants.get(merchantId);
    if (!m) return null;
    m.state = 'suspended';
    eventEngine.emit('merchant.suspended', { merchantId, reason }, 0);
    return m;
  }

  getMerchant(merchantId: string): MerchantAccount | undefined { return this.merchants.get(merchantId); }
  getProducts(merchantId: string): Product[] { return [...this.products.values()].filter((p) => p.merchantId === merchantId); }
  getInvoices(merchantId: string): Invoice[] { return [...this.invoices.values()].filter((i) => i.merchantId === merchantId); }
  getCustomers(merchantId: string): Customer[] { return [...this.customers.values()].filter((c) => c.merchantId === merchantId); }
  getRefunds(merchantId: string): Refund[] { return [...this.refunds.values()].filter((r) => r.merchantId === merchantId); }
  allMerchants(): MerchantAccount[] { return [...this.merchants.values()]; }

  reset(): void {
    this.merchants.clear(); this.products.clear(); this.invoices.clear();
    this.customers.clear(); this.refunds.clear();
  }
}

export const merchantPlatform = new MerchantPlatform();
