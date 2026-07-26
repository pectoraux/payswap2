/**
 * PaySwap Protocol — Webhook Engine.
 *
 * Merchants register HTTP endpoints to receive event notifications. When a
 * protocol event fires (payment.created, payment.completed, payment.failed,
 * payment.disputed, …) the engine signs the payload with HMAC-SHA256 and
 * delivers it to every matching endpoint.
 *
 * Delivery is simulated in-process (no real HTTP) — this is intentional for
 * the in-memory runtime. Production deployments wrap the same interface with
 * a queue + fetch worker. Every delivery is recorded with its signature so
 * consumers can verify authenticity via `verifySignature()`.
 *
 * Signature scheme: `X-PaySwap-Signature: sha256=<hex>` over the raw JSON body.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { uid, nowTs } from '@/kernel/support';

export interface WebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  events: string[];          // subscribed event types; '*' = all
  secret: string;            // HMAC signing secret
  active: boolean;
  createdAt: number;
}

export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'pending';

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  merchantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  body: string;              // JSON.stringify(payload)
  signature: string;         // hex digest
  deliveredAt: number;
  status: WebhookDeliveryStatus;
  attempt: number;
  responseStatus?: number;
  responsePreview?: string;
  error?: string;
}

export const DEFAULT_WEBHOOK_EVENTS: string[] = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payment.disputed',
];

export const WEBHOOK_SIGNATURE_HEADER = 'X-PaySwap-Signature';
export const WEBHOOK_SIGNATURE_PREFIX = 'sha256=';

export class WebhookEngine {
  private endpoints = new Map<string, WebhookEndpoint>();
  private deliveries: WebhookDelivery[] = [];

  // ----------------------------------------------------------------- register
  register(params: { merchantId: string; url: string; events?: string[]; secret?: string }): WebhookEndpoint {
    const id = uid('wh');
    const events = params.events && params.events.length > 0 ? [...params.events] : [...DEFAULT_WEBHOOK_EVENTS];
    const endpoint: WebhookEndpoint = {
      id,
      merchantId: params.merchantId,
      url: params.url,
      events,
      secret: params.secret ?? uid('whsec'),
      active: true,
      createdAt: nowTs(),
    };
    this.endpoints.set(id, endpoint);
    return endpoint;
  }

  // ---------------------------------------------------------------------- get
  getEndpoint(endpointId: string): WebhookEndpoint | undefined {
    return this.endpoints.get(endpointId);
  }

  getEndpointsByMerchant(merchantId: string): WebhookEndpoint[] {
    return [...this.endpoints.values()].filter((e) => e.merchantId === merchantId);
  }

  allEndpoints(): WebhookEndpoint[] { return [...this.endpoints.values()]; }

  /** Activate/deactivate an endpoint without deleting it. */
  setActive(endpointId: string, active: boolean): boolean {
    const ep = this.endpoints.get(endpointId);
    if (!ep) return false;
    ep.active = active;
    return true;
  }

  // ---------------------------------------------------------------------- emit
  /**
   * Find every active endpoint for `merchantId` subscribed to `eventType` and
   * deliver the signed payload. Returns the list of deliveries.
   */
  async emit(params: { merchantId: string; eventType: string; payload: Record<string, unknown> }): Promise<WebhookDelivery[]> {
    const { merchantId, eventType, payload } = params;
    const matches = this.getEndpointsByMerchant(merchantId).filter((e) => e.active && this.subscribesTo(e, eventType));
    const deliveries: WebhookDelivery[] = [];
    for (const ep of matches) {
      const delivery = await this.deliver(ep, eventType, payload);
      deliveries.push(delivery);
    }
    return deliveries;
  }

  // --------------------------------------------------------- verifySignature
  /**
   * Verify an incoming webhook signature.
   * `signature` may be either the bare hex digest or `sha256=<hex>`.
   */
  verifySignature(body: string, signature: string, secret: string): boolean {
    if (!body || !signature || !secret) return false;
    const expected = this.sign(body, secret);
    const received = signature.startsWith(WEBHOOK_SIGNATURE_PREFIX)
      ? signature.slice(WEBHOOK_SIGNATURE_PREFIX.length)
      : signature;
    if (expected.length !== received.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ queries
  getDeliveries(endpointId: string): WebhookDelivery[] {
    return this.deliveries.filter((d) => d.endpointId === endpointId);
  }

  allDeliveries(): WebhookDelivery[] { return [...this.deliveries]; }

  // ------------------------------------------------------------------ helpers
  private subscribesTo(ep: WebhookEndpoint, eventType: string): boolean {
    if (ep.events.includes('*')) return true;
    return ep.events.includes(eventType);
  }

  private sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  private async deliver(ep: WebhookEndpoint, eventType: string, payload: Record<string, unknown>): Promise<WebhookDelivery> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, ep.secret);
    // Simulated successful delivery. Real implementation would POST with retries.
    const delivery: WebhookDelivery = {
      id: uid('whd'),
      endpointId: ep.id,
      merchantId: ep.merchantId,
      eventType,
      payload,
      body,
      signature,
      deliveredAt: nowTs(),
      status: 'delivered',
      attempt: 1,
      responseStatus: 200,
      responsePreview: 'OK (simulated delivery)',
    };
    this.deliveries.push(delivery);
    return delivery;
  }
}

export const webhookEngine = new WebhookEngine();
