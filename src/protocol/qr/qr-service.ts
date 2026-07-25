/**
 * PaySwap Protocol — QR Payment System.
 *
 * Users can scan QR codes to pay:
 *   - Scan another user's QR → account-to-account payment
 *   - Scan merchant QR → merchant payment
 *   - Scan invoice QR → invoice payment
 *
 * QR payload contains only payment metadata — no private information.
 * After scanning, a normal Payment Intent is created and flows through
 * the standard protocol runtime.
 */
import { uid } from '@/kernel/support';

export type QRType = 'static' | 'dynamic' | 'invoice' | 'donation' | 'subscription' | 'checkout';

export interface QRPayload {
  v: 1; // version
  type: QRType;
  merchant?: string;
  wallet?: string;
  account?: string;
  currency: string;
  amount?: number;
  reference?: string;
  expires?: number;
  metadata?: Record<string, string>;
}

export interface QRCode {
  id: string;
  type: QRType;
  payload: QRPayload;
  encoded: string;
  createdAt: number;
  expiresAt: number | null;
  used: boolean;
  usedAt: number | null;
  paymentId?: string;
}

export class QRService {
  private codes: Map<string, QRCode> = new Map();

  /** Generate a static QR (reusable, no expiry). */
  generateStatic(params: {
    merchant?: string; wallet?: string; account?: string; currency: string;
  }): QRCode {
    return this.create({
      type: 'static',
      payload: { v: 1, type: 'static', merchant: params.merchant, wallet: params.wallet, account: params.account, currency: params.currency },
      expiresAt: null,
    });
  }

  /** Generate a dynamic QR (one-time, with expiry). */
  generateDynamic(params: {
    merchant?: string; wallet?: string; account?: string;
    currency: string; amount: number; reference?: string; expiresMs?: number;
  }): QRCode {
    return this.create({
      type: 'dynamic',
      payload: {
        v: 1, type: 'dynamic',
        merchant: params.merchant, wallet: params.wallet, account: params.account,
        currency: params.currency, amount: params.amount, reference: params.reference,
        expires: Date.now() + (params.expiresMs ?? 300000),
      },
      expiresAt: Date.now() + (params.expiresMs ?? 300000),
    });
  }

  /** Generate an invoice QR. */
  generateInvoice(params: {
    merchant: string; currency: string; amount: number;
    reference: string; expiresMs?: number;
  }): QRCode {
    return this.create({
      type: 'invoice',
      payload: {
        v: 1, type: 'invoice', merchant: params.merchant,
        currency: params.currency, amount: params.amount, reference: params.reference,
        expires: Date.now() + (params.expiresMs ?? 86400000),
      },
      expiresAt: Date.now() + (params.expiresMs ?? 86400000),
    });
  }

  /** Generate a donation QR (no fixed amount). */
  generateDonation(params: {
    merchant: string; currency: string; reference?: string;
  }): QRCode {
    return this.create({
      type: 'donation',
      payload: {
        v: 1, type: 'donation', merchant: params.merchant,
        currency: params.currency, reference: params.reference,
      },
      expiresAt: null,
    });
  }

  /** Generate a subscription QR. */
  generateSubscription(params: {
    merchant: string; currency: string; amount: number;
    reference: string; interval: 'daily' | 'weekly' | 'monthly';
  }): QRCode {
    return this.create({
      type: 'subscription',
      payload: {
        v: 1, type: 'subscription', merchant: params.merchant,
        currency: params.currency, amount: params.amount, reference: params.reference,
        metadata: { interval: params.interval },
      },
      expiresAt: null,
    });
  }

  /** Generate a checkout QR (for website POS). */
  generateCheckout(params: {
    merchant: string; currency: string; amount: number;
    reference?: string; expiresMs?: number;
  }): QRCode {
    return this.create({
      type: 'checkout',
      payload: {
        v: 1, type: 'checkout', merchant: params.merchant,
        currency: params.currency, amount: params.amount, reference: params.reference,
        expires: Date.now() + (params.expiresMs ?? 600000),
      },
      expiresAt: Date.now() + (params.expiresMs ?? 600000),
    });
  }

  /** Decode a scanned QR string. */
  decode(encoded: string): QRPayload | null {
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as QRPayload;
      if (payload.v !== 1) return null;
      if (payload.expires && Date.now() > payload.expires) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /** Resolve a QR code to a payment intent (creates intent via TransactionEngine). */
  resolve(qrId: string): { payload: QRPayload; expired: boolean; used: boolean } | null {
    const qr = this.codes.get(qrId);
    if (!qr) return null;
    const expired = qr.expiresAt !== null && Date.now() > qr.expiresAt;
    return { payload: qr.payload, expired, used: qr.used };
  }

  /** Mark QR as used (after payment created). */
  markUsed(qrId: string, paymentId: string): void {
    const qr = this.codes.get(qrId);
    if (qr) { qr.used = true; qr.usedAt = Date.now(); qr.paymentId = paymentId; }
  }

  get(qrId: string): QRCode | undefined { return this.codes.get(qrId); }
  all(): QRCode[] { return [...this.codes.values()]; }

  reset(): void { this.codes.clear(); }

  private create(params: { type: QRType; payload: QRPayload; expiresAt: number | null }): QRCode {
    const qr: QRCode = {
      id: uid('qr'),
      type: params.type,
      payload: params.payload,
      encoded: Buffer.from(JSON.stringify(params.payload)).toString('base64'),
      createdAt: Date.now(),
      expiresAt: params.expiresAt,
      used: false, usedAt: null,
    };
    this.codes.set(qr.id, qr);
    return qr;
  }
}

export const qrService = new QRService();
