/**
 * PaySwap Protocol — Webhook Engine.
 *
 * Merchants register HTTP endpoints to receive event notifications. When a
 * protocol event fires (payment.created, payment.completed, payment.failed,
 * payment.disputed, …) the engine signs the payload with HMAC-SHA256 and
 * delivers it to every matching endpoint.
 *
 * OPS-2: Delivery now uses real HTTP fetch with exponential backoff retry
 * (3 attempts: immediate, +10s, +60s). Failed deliveries are dead-lettered
 * and can be replayed from the dashboard via `replayDelivery()`.
 *
 * Signature scheme (OPS-2): Stripe-style `t=<timestamp>,v1=<hmac>` over
 * `timestamp.body`. The timestamp prevents replay attacks (recipients
 * reject signatures older than 5 minutes).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export interface WebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  events: string[];          // subscribed event types; '*' = all
  secret: string;            // HMAC signing secret
  active: boolean;
  createdAt: number;
}

export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'pending' | 'dead_lettered' | 'replaying';

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
  // H-6 fix (SEC-011, regrade 2026-08-08): timestamp freshness alone
  // (reject signatures older than maxAgeMs) does NOT stop replay — a
  // signature captured and resent within that window still verifies as
  // valid every time. This tracks signatures already accepted by
  // verifyStripeSignature so a second presentation of the exact same
  // signed payload is rejected. Keyed by `t=<timestamp>,v1=<hmac>` (the
  // full header — unique per delivery since the HMAC binds timestamp +
  // body + secret). Entries older than the freshness window are already
  // rejected on timestamp grounds, so periodic sweep just bounds memory.
  private seenSignatures = new Map<string, number>();

  private pruneSeenSignatures(now: number, maxAgeMs: number): void {
    for (const [sig, seenAt] of this.seenSignatures) {
      if (now - seenAt > maxAgeMs) this.seenSignatures.delete(sig);
    }
  }

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

  /**
   * OPS-2: Stripe-style webhook signature.
   *
   * Format: `t=<timestamp>,v1=<hmac>`
   *
   * The timestamp prevents replay attacks (recipients reject signatures
   * older than 5 minutes). The HMAC is computed over `t.body` so the
   * timestamp is bound to the payload.
   */
  private signStripeStyle(body: string, secret: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${body}`;
    const hmac = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    return `t=${timestamp},v1=${hmac}`;
  }

  /**
   * OPS-2: Verify a Stripe-style `t=,v1=` signature.
   *
   * H-6 fix (SEC-011, regrade 2026-08-08): timestamp freshness rejects
   * OLD signatures but not REPLAYED ones — a signature captured within
   * the freshness window and resent verified as valid every time it was
   * presented. `dedupe` (default true) now also rejects a signature
   * that's already been accepted once, closing that gap. Pass
   * `dedupe: false` only for read-only signature *inspection* (e.g. a
   * "does this signature look right" debug tool) that must not consume
   * the one-time budget of a real delivery.
   */
  verifyStripeSignature(body: string, signatureHeader: string, secret: string, maxAgeMs: number = 5 * 60 * 1000, dedupe = true): boolean {
    if (!body || !signatureHeader || !secret) return false;
    // Parse the signature header: t=1234567890,v1=abc123...
    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parseInt(parts['t'] ?? '0', 10);
    const v1 = parts['v1'];
    if (!timestamp || !v1) return false;

    // Check timestamp freshness (rejects OLD signatures).
    const now = Date.now();
    if (now - timestamp > maxAgeMs) return false;

    // Recompute the HMAC.
    const signedPayload = `${timestamp}.${body}`;
    const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

    let valid: boolean;
    try {
      valid = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(v1, 'utf8'));
    } catch {
      valid = false;
    }
    if (!valid) return false;

    if (dedupe) {
      this.pruneSeenSignatures(now, maxAgeMs);
      if (this.seenSignatures.has(signatureHeader)) return false; // REPLAY
      this.seenSignatures.set(signatureHeader, now);
    }
    return true;
  }

  private sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  /**
   * OPS-2: Deliver a webhook with exponential backoff retry + dead-letter.
   *
   * Retry schedule: 3 attempts with exponential backoff:
   *   Attempt 1: immediate
   *   Attempt 2: +10 seconds
   *   Attempt 3: +60 seconds
   *
   * If all 3 fail, the delivery is dead-lettered (status='dead_lettered')
   * and can be replayed from the dashboard via `replayDelivery()`.
   *
   * The delivery uses the Stripe-style `t=,v1=` signature.
   */
  private async deliver(ep: WebhookEndpoint, eventType: string, payload: Record<string, unknown>): Promise<WebhookDelivery> {
    const body = JSON.stringify(payload);
    const timestamp = nowTs();
    const signature = this.signStripeStyle(body, ep.secret, timestamp);

    const delivery: WebhookDelivery = {
      id: uid('whd'),
      endpointId: ep.id,
      merchantId: ep.merchantId,
      eventType,
      payload,
      body,
      signature,
      deliveredAt: timestamp,
      status: 'pending',
      attempt: 0,
      responseStatus: 0,
      responsePreview: '',
    };

    // OPS-2: retry with exponential backoff.
    const retryDelays = [0, 10_000, 60_000]; // 0s, 10s, 60s
    for (let i = 0; i < retryDelays.length; i++) {
      if (retryDelays[i] > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(retryDelays[i], 5_000))); // cap at 5s in-process for dev
      }
      delivery.attempt = i + 1;
      try {
        const response = await fetch(ep.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': eventType,
            'X-Webhook-Delivery': delivery.id,
          },
          body,
          signal: AbortSignal.timeout(10_000), // 10s timeout per attempt
        });

        delivery.responseStatus = response.status;
        delivery.responsePreview = `HTTP ${response.status} ${response.statusText}`;

        if (response.status >= 200 && response.status < 300) {
          delivery.status = 'delivered';
          delivery.deliveredAt = nowTs();
          this.deliveries.push(delivery);
          return delivery;
        }
        // Non-2xx → retry
      } catch (err) {
        delivery.responseStatus = 0;
        delivery.responsePreview = `Error: ${err instanceof Error ? err.message : 'unknown'}`;
        // Network error → retry
      }
    }

    // All retries exhausted → dead-letter.
    delivery.status = 'dead_lettered';
    delivery.deliveredAt = nowTs();
    this.deliveries.push(delivery);

    // Emit an event for the dead-letter (operators can alert on this).
    eventEngine.emit('webhook.dead_lettered', {
      deliveryId: delivery.id,
      endpointId: ep.id,
      merchantId: ep.merchantId,
      eventType,
      attempts: delivery.attempt,
      lastResponse: delivery.responsePreview,
      ts: nowTs(),
    });

    return delivery;
  }

  /**
   * OPS-2: Replay a dead-lettered delivery. Resets the status to 'pending'
   * and re-attempts delivery. Useful when the merchant's endpoint was down
   * and is now back up.
   */
  async replayDelivery(deliveryId: string): Promise<WebhookDelivery | null> {
    const delivery = this.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return null;
    if (delivery.status !== 'dead_lettered' && delivery.status !== 'failed') {
      return delivery; // Already delivered, nothing to replay.
    }
    const ep = this.endpoints.get(delivery.endpointId);
    if (!ep || !ep.active) return null;

    // Re-deliver with a fresh signature.
    const timestamp = nowTs();
    const newSignature = this.signStripeStyle(delivery.body, ep.secret, timestamp);
    delivery.signature = newSignature;
    delivery.status = 'replaying';

    // Attempt delivery again (single attempt, no retry — the caller can
    // call replayDelivery() again if it fails).
    try {
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': newSignature,
          'X-Webhook-Event': delivery.eventType,
          'X-Webhook-Delivery': delivery.id,
          'X-Webhook-Replay': 'true',
        },
        body: delivery.body,
        signal: AbortSignal.timeout(10_000),
      });
      delivery.responseStatus = response.status;
      delivery.responsePreview = `Replay: HTTP ${response.status}`;
      if (response.status >= 200 && response.status < 300) {
        delivery.status = 'delivered';
        delivery.deliveredAt = nowTs();
      } else {
        delivery.status = 'dead_lettered';
      }
    } catch (err) {
      delivery.responseStatus = 0;
      delivery.responsePreview = `Replay error: ${err instanceof Error ? err.message : 'unknown'}`;
      delivery.status = 'dead_lettered';
    }
    return delivery;
  }

  /**
   * OPS-2: Get all dead-lettered deliveries for a merchant (for the dashboard).
   */
  getDeadLetteredDeliveries(merchantId?: string): WebhookDelivery[] {
    return this.deliveries.filter(d => {
      if (d.status !== 'dead_lettered') return false;
      if (merchantId && d.merchantId !== merchantId) return false;
      return true;
    });
  }

  /**
   * OPS-2: Get delivery history for an endpoint (for the dashboard).
   */
  getDeliveryHistory(endpointId: string, limit: number = 50): WebhookDelivery[] {
    return this.deliveries
      .filter(d => d.endpointId === endpointId)
      .slice(-limit)
      .reverse();
  }
}

export const webhookEngine = new WebhookEngine();
