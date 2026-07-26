/**
 * PaySwap Protocol — Merchant Platform (v2) — Invoices.
 *
 * Invoice generation + lifecycle management.
 *
 * Lifecycle:
 *   draft  → sent     (`sendInvoice` — emails the customer)
 *   sent   → paid     (`markPaid` — customer has paid, links to paymentId)
 *   sent   → overdue  (`markOverdue` — past `dueDate` and still unpaid)
 *   *      → void     (`voidInvoice` — cancels the invoice)
 *
 * Invoice numbers are sequential per merchant (`INV-0001`, `INV-0002`, …).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.invoice_created`  — on `createInvoice`.
 *  - `merchant.invoice_sent`     — on `sendInvoice`.
 *  - `merchant.invoice_paid`     — on `markPaid`.
 *  - `merchant.invoice_overdue`  — on `markOverdue`.
 *  - `merchant.invoice_voided`   — on `voidInvoice`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { Invoice, InvoiceFilter, InvoiceItem, InvoiceStatus } from './types';

/** Parameters for `createInvoice`. */
export interface CreateInvoiceParams {
  customerId: string;
  items: InvoiceItem[];
  currency: string;
  tax?: number;
  dueDate: number;
  metadata?: Record<string, unknown>;
}

/**
 * InvoiceService owns the per-merchant invoice counter, the invoice store,
 * and the lifecycle transitions.
 */
export class InvoiceService {
  private invoices = new Map<string, Invoice>();
  /** Per-merchant invoice counter (for sequential numbering). */
  private counters = new Map<string, number>();

  // ----------------------------------------------------------- generateInvoiceNumber
  /**
   * Generate the next sequential invoice number for a merchant
   * (`INV-0001`, `INV-0002`, …). The counter is per-merchant.
   */
  generateInvoiceNumber(merchantId: string): string {
    const next = (this.counters.get(merchantId) ?? 0) + 1;
    this.counters.set(merchantId, next);
    return `INV-${next.toString().padStart(4, '0')}`;
  }

  // ------------------------------------------------------------- createInvoice
  createInvoice(merchantId: string, params: CreateInvoiceParams): Invoice {
    const number = this.generateInvoiceNumber(merchantId);
    const subtotal = round(
      params.items.reduce((s, i) => s + i.total, 0),
      6,
    );
    const tax = round(params.tax ?? 0, 6);
    const total = round(subtotal + tax, 6);
    const invoice: Invoice = {
      id: uid('inv'),
      merchantId,
      customerId: params.customerId,
      number,
      items: params.items.map((i) => ({ ...i })),
      subtotal,
      tax,
      total,
      currency: params.currency,
      status: 'draft',
      dueDate: params.dueDate,
      createdAt: nowTs(),
    };
    this.invoices.set(invoice.id, invoice);
    eventEngine.emit('merchant.invoice_created', {
      merchantId,
      invoiceId: invoice.id,
      number,
      customerId: params.customerId,
      subtotal,
      tax,
      total,
      currency: params.currency,
      dueDate: params.dueDate,
    });
    return invoice;
  }

  // -------------------------------------------------------------- sendInvoice
  /**
   * Email the invoice to the customer and transition to 'sent'. Only
   * invoices in 'draft' state can be sent.
   */
  sendInvoice(invoiceId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.status !== 'draft') return null;
    inv.status = 'sent';
    inv.sentAt = nowTs();
    eventEngine.emit('merchant.invoice_sent', {
      merchantId: inv.merchantId,
      invoiceId: inv.id,
      number: inv.number,
      customerId: inv.customerId,
      total: inv.total,
      currency: inv.currency,
      sentAt: inv.sentAt,
    });
    return inv;
  }

  // ------------------------------------------------------------------ markPaid
  /**
   * Mark an invoice as paid. Only invoices in 'sent' (or 'overdue') state
   * can be marked paid. Links the invoice to the payment id.
   */
  markPaid(invoiceId: string, paymentId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return null;
    if (inv.status !== 'sent' && inv.status !== 'overdue') return null;
    inv.status = 'paid';
    inv.paidAt = nowTs();
    inv.paymentId = paymentId;
    eventEngine.emit('merchant.invoice_paid', {
      merchantId: inv.merchantId,
      invoiceId: inv.id,
      number: inv.number,
      customerId: inv.customerId,
      paymentId,
      total: inv.total,
      currency: inv.currency,
      paidAt: inv.paidAt,
    });
    return inv;
  }

  // --------------------------------------------------------------- markOverdue
  /**
   * Mark a sent invoice as overdue. Only invoices in 'sent' state past
   * their `dueDate` can be marked overdue.
   */
  markOverdue(invoiceId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.status !== 'sent') return null;
    if (nowTs() < inv.dueDate) return null;
    inv.status = 'overdue';
    eventEngine.emit('merchant.invoice_overdue', {
      merchantId: inv.merchantId,
      invoiceId: inv.id,
      number: inv.number,
      customerId: inv.customerId,
      total: inv.total,
      currency: inv.currency,
      dueDate: inv.dueDate,
    });
    return inv;
  }

  // --------------------------------------------------------------- voidInvoice
  /**
   * Void an invoice. Only invoices in 'draft', 'sent', or 'overdue' state
   * can be voided (paid invoices cannot be voided — issue a refund instead).
   */
  voidInvoice(invoiceId: string): Invoice | null {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return null;
    if (inv.status === 'paid' || inv.status === 'void') return null;
    inv.status = 'void';
    eventEngine.emit('merchant.invoice_voided', {
      merchantId: inv.merchantId,
      invoiceId: inv.id,
      number: inv.number,
      previousStatus: inv.status,
    });
    return inv;
  }

  // -------------------------------------------------------------------- getters
  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  getByMerchant(merchantId: string, filter?: InvoiceFilter): Invoice[] {
    let list = [...this.invoices.values()].filter((i) => i.merchantId === merchantId);
    if (filter) {
      if (filter.status) list = list.filter((i) => i.status === filter.status);
      if (filter.customerId) list = list.filter((i) => i.customerId === filter.customerId);
      if (typeof filter.from === 'number') list = list.filter((i) => i.createdAt >= filter.from!);
      if (typeof filter.to === 'number') list = list.filter((i) => i.createdAt <= filter.to!);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  getOverdue(merchantId: string): Invoice[] {
    return this.getByMerchant(merchantId).filter((i) => i.status === 'overdue');
  }

  /**
   * Sweep all 'sent' invoices for a merchant whose `dueDate` has passed
   * and mark them overdue. Returns the invoices that were transitioned.
   */
  sweepOverdue(merchantId: string): Invoice[] {
    const overdue: Invoice[] = [];
    for (const inv of this.invoices.values()) {
      if (inv.merchantId !== merchantId) continue;
      if (inv.status === 'sent' && nowTs() >= inv.dueDate) {
        const updated = this.markOverdue(inv.id);
        if (updated) overdue.push(updated);
      }
    }
    return overdue;
  }

  all(): Invoice[] {
    return [...this.invoices.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.invoices.clear();
    this.counters.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_INVOICE_SERVICE?: InvoiceService };
export const invoiceService: InvoiceService =
  _g.__PAYSWAP_INVOICE_SERVICE ?? new InvoiceService();
if (!_g.__PAYSWAP_INVOICE_SERVICE) _g.__PAYSWAP_INVOICE_SERVICE = invoiceService;

export type { InvoiceStatus } from './types';
