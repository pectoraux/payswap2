/**
 * PaySwap Protocol — Merchant Platform (v2) — Payment Requests.
 *
 * Payment requests are shareable pay-links a merchant issues to a customer.
 * A customer clicks the link, pays, and the request transitions to 'paid'
 * (linked to the resulting payment id). Requests can also expire (after
 * `expiresAt`) or be canceled (by the merchant).
 *
 * Lifecycle:
 *   pending → paid      (`markPaid` — customer paid via the link)
 *   pending → canceled  (`cancel` — merchant cancels the request)
 *   pending → expired   (`expireStale` — past `expiresAt` and still pending)
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.payment_request_created`  — on `createRequest`.
 *  - `merchant.payment_request_paid`     — on `markPaid`.
 *  - `merchant.payment_request_canceled` — on `cancel`.
 *  - `merchant.payment_request_expired`  — on `expireStale` (per request).
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { PaymentRequest, PaymentRequestFilter } from './types';

/** Default expiry for a payment request (24 hours). */
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Parameters for `createRequest`. */
export interface CreatePaymentRequestParams {
  customerId?: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  expiresAt?: number;
  /** Expiry in milliseconds from now (alternative to `expiresAt`). */
  expiresInMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * PaymentRequestService owns the payment-request store and lifecycle.
 */
export class PaymentRequestService {
  private requests = new Map<string, PaymentRequest>();

  // ------------------------------------------------------------- createRequest
  createRequest(merchantId: string, params: CreatePaymentRequestParams): PaymentRequest {
    const now = nowTs();
    let expiresAt: number;
    if (typeof params.expiresAt === 'number') {
      expiresAt = params.expiresAt;
    } else if (typeof params.expiresInMs === 'number') {
      expiresAt = now + params.expiresInMs;
    } else {
      expiresAt = now + DEFAULT_EXPIRY_MS;
    }
    const req: PaymentRequest = {
      id: uid('preq'),
      merchantId,
      customerId: params.customerId,
      amount: round(params.amount, 6),
      currency: params.currency,
      description: params.description,
      reference: params.reference,
      status: 'pending',
      expiresAt,
      createdAt: now,
    };
    this.requests.set(req.id, req);
    eventEngine.emit('merchant.payment_request_created', {
      merchantId,
      requestId: req.id,
      customerId: req.customerId,
      amount: req.amount,
      currency: req.currency,
      reference: req.reference,
      expiresAt,
    });
    return req;
  }

  // --------------------------------------------------------------- markPaid
  /**
   * Mark a payment request as paid. Only 'pending' requests can be paid
   * (expired / canceled requests cannot). Links the request to the
   * resulting payment id.
   */
  markPaid(requestId: string, paymentId: string): PaymentRequest | null {
    const r = this.requests.get(requestId);
    if (!r || r.status !== 'pending') return null;
    if (nowTs() > r.expiresAt) {
      // Auto-expire instead of paying.
      r.status = 'expired';
      eventEngine.emit('merchant.payment_request_expired', {
        merchantId: r.merchantId,
        requestId: r.id,
        expiredAt: nowTs(),
      });
      return null;
    }
    r.status = 'paid';
    r.paidAt = nowTs();
    r.paymentId = paymentId;
    eventEngine.emit('merchant.payment_request_paid', {
      merchantId: r.merchantId,
      requestId: r.id,
      paymentId,
      amount: r.amount,
      currency: r.currency,
      customerId: r.customerId,
      paidAt: r.paidAt,
    });
    return r;
  }

  // ------------------------------------------------------------------ cancel
  cancel(requestId: string): PaymentRequest | null {
    const r = this.requests.get(requestId);
    if (!r || r.status !== 'pending') return null;
    r.status = 'canceled';
    eventEngine.emit('merchant.payment_request_canceled', {
      merchantId: r.merchantId,
      requestId: r.id,
      canceledAt: nowTs(),
    });
    return r;
  }

  // --------------------------------------------------------------- expireStale
  /**
   * Expire all 'pending' requests whose `expiresAt` has passed. Returns
   * the list of requests that were transitioned to 'expired'.
   */
  expireStale(): PaymentRequest[] {
    const now = nowTs();
    const expired: PaymentRequest[] = [];
    for (const r of this.requests.values()) {
      if (r.status === 'pending' && now >= r.expiresAt) {
        r.status = 'expired';
        expired.push(r);
        eventEngine.emit('merchant.payment_request_expired', {
          merchantId: r.merchantId,
          requestId: r.id,
          expiredAt: now,
        });
      }
    }
    return expired;
  }

  // -------------------------------------------------------------------- getters
  getRequest(id: string): PaymentRequest | undefined {
    return this.requests.get(id);
  }

  getByMerchant(merchantId: string, filter?: PaymentRequestFilter): PaymentRequest[] {
    let list = [...this.requests.values()].filter((r) => r.merchantId === merchantId);
    if (filter) {
      if (filter.status) list = list.filter((r) => r.status === filter.status);
      if (filter.customerId) list = list.filter((r) => r.customerId === filter.customerId);
      if (typeof filter.from === 'number') list = list.filter((r) => r.createdAt >= filter.from!);
      if (typeof filter.to === 'number') list = list.filter((r) => r.createdAt <= filter.to!);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  all(): PaymentRequest[] {
    return [...this.requests.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.requests.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_PAYMENT_REQUEST_SERVICE?: PaymentRequestService };
export const paymentRequestService: PaymentRequestService =
  _g.__PAYSWAP_PAYMENT_REQUEST_SERVICE ?? new PaymentRequestService();
if (!_g.__PAYSWAP_PAYMENT_REQUEST_SERVICE) {
  _g.__PAYSWAP_PAYMENT_REQUEST_SERVICE = paymentRequestService;
}
