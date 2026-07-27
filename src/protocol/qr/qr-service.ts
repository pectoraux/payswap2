/**
 * PaySwap Protocol — QR Code Service.
 *
 * Six QR code types covering the full merchant surface area:
 *
 *   static       — reusable merchant identity QR (no amount, no expiry)
 *   dynamic      — one-shot payment QR with amount + optional reference
 *   invoice      — dynamic QR tied to a specific invoice reference
 *   donation     — open-amount QR for civic / charity flows
 *   subscription — recurring payment QR with interval (daily/weekly/monthly)
 *   checkout     — short-lived session QR for online checkout handoff
 *
 * The `encoded` field is a URL-safe base64 of the JSON payload — production
 * renders this into an actual image at the edge. The QR record itself is
 * stored in-process so merchants can poll status / inspect generated codes.
 */
import { uid, nowTs } from '@/kernel/support';

export type QRType = 'static' | 'dynamic' | 'invoice' | 'donation' | 'subscription' | 'checkout';

export type QRInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface QRCode {
  id: string;
  type: QRType;
  merchant: string;
  wallet?: string;
  currency: string;
  amount?: number;
  reference?: string;
  interval?: QRInterval;
  payload: Record<string, unknown>;
  encoded: string;
  createdAt: number;
  expiresAt: number | null;
}

const DEFAULT_DYNAMIC_EXPIRY_MS = 5 * 60 * 1000;     // 5 minutes
const DEFAULT_CHECKOUT_EXPIRY_MS = 10 * 60 * 1000;   // 10 minutes
const DEFAULT_INVOICE_EXPIRY_MS  = 24 * 60 * 60 * 1000; // 24 hours

export class QRService {
  private codes = new Map<string, QRCode>();

  // ----------------------------------------------------------- generateStatic
  generateStatic(params: { merchant: string; wallet: string; currency: string }): QRCode {
    const { merchant, wallet, currency } = params;
    const id = uid('qr');
    const payload = { id, type: 'static', merchant, wallet, currency };
    const qr: QRCode = {
      id, type: 'static', merchant, wallet, currency,
      payload, encoded: this.encode(payload),
      createdAt: nowTs(), expiresAt: null,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // ---------------------------------------------------------- generateDynamic
  generateDynamic(params: {
    merchant: string; wallet: string; currency: string;
    amount: number; reference?: string; expiresMs?: number;
  }): QRCode {
    const { merchant, wallet, currency, amount, reference, expiresMs } = params;
    if (amount <= 0) throw new Error('amount must be positive for dynamic QR');
    const id = uid('qr');
    const createdAt = nowTs();
    const expiresAt = createdAt + (expiresMs ?? DEFAULT_DYNAMIC_EXPIRY_MS);
    const payload = { id, type: 'dynamic', merchant, wallet, currency, amount, reference };
    const qr: QRCode = {
      id, type: 'dynamic', merchant, wallet, currency, amount, reference,
      payload, encoded: this.encode(payload),
      createdAt, expiresAt,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // ----------------------------------------------------------- generateInvoice
  generateInvoice(params: {
    merchant: string; currency: string; amount: number;
    reference: string; expiresMs?: number;
  }): QRCode {
    const { merchant, currency, amount, reference, expiresMs } = params;
    if (amount <= 0) throw new Error('amount must be positive for invoice QR');
    if (!reference) throw new Error('reference is required for invoice QR');
    const id = uid('qr');
    const createdAt = nowTs();
    const expiresAt = createdAt + (expiresMs ?? DEFAULT_INVOICE_EXPIRY_MS);
    const payload = { id, type: 'invoice', merchant, currency, amount, reference };
    const qr: QRCode = {
      id, type: 'invoice', merchant, currency, amount, reference,
      payload, encoded: this.encode(payload),
      createdAt, expiresAt,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // --------------------------------------------------------- generateDonation
  generateDonation(params: {
    merchant: string; currency: string; reference?: string;
  }): QRCode {
    const { merchant, currency, reference } = params;
    const id = uid('qr');
    const payload = { id, type: 'donation', merchant, currency, reference };
    const qr: QRCode = {
      id, type: 'donation', merchant, currency, reference,
      payload, encoded: this.encode(payload),
      createdAt: nowTs(), expiresAt: null,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // ----------------------------------------------------- generateSubscription
  generateSubscription(params: {
    merchant: string; currency: string; amount: number;
    reference: string; interval: QRInterval;
  }): QRCode {
    const { merchant, currency, amount, reference, interval } = params;
    if (amount <= 0) throw new Error('amount must be positive for subscription QR');
    if (!reference) throw new Error('reference is required for subscription QR');
    const id = uid('qr');
    const payload = { id, type: 'subscription', merchant, currency, amount, reference, interval };
    const qr: QRCode = {
      id, type: 'subscription', merchant, currency, amount, reference, interval,
      payload, encoded: this.encode(payload),
      createdAt: nowTs(), expiresAt: null,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // ----------------------------------------------------------- generateCheckout
  generateCheckout(params: {
    merchant: string; currency: string; amount: number;
    reference?: string; expiresMs?: number;
  }): QRCode {
    const { merchant, currency, amount, reference, expiresMs } = params;
    if (amount <= 0) throw new Error('amount must be positive for checkout QR');
    const id = uid('qr');
    const createdAt = nowTs();
    const expiresAt = createdAt + (expiresMs ?? DEFAULT_CHECKOUT_EXPIRY_MS);
    const payload = { id, type: 'checkout', merchant, currency, amount, reference };
    const qr: QRCode = {
      id, type: 'checkout', merchant, currency, amount, reference,
      payload, encoded: this.encode(payload),
      createdAt, expiresAt,
    };
    this.codes.set(id, qr);
    return qr;
  }

  // ----------------------------------------------------------------- queries
  all(): QRCode[] { return [...this.codes.values()]; }

  get(id: string): QRCode | undefined { return this.codes.get(id); }

  /** True if the QR exists and is still within its validity window. */
  isValid(id: string, now: number = nowTs()): boolean {
    const qr = this.codes.get(id);
    if (!qr) return false;
    if (qr.expiresAt === null) return true;
    return now < qr.expiresAt;
  }

  // ----------------------------------------------------------------- helpers
  private encode(payload: Record<string, unknown>): string {
    // URL-safe base64 of UTF-8 JSON.
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
}

export const qrService = new QRService();
