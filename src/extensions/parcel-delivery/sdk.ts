/**
 * Parcel Delivery Extension — Production Merchant SDK.
 *
 * PRODUCTION HARDENING #5: Typed client with retries, idempotency,
 * webhook verification. Usable from Node, React, Next.js, React Native.
 */

import { Money } from '@/money';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// TYPED CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export interface ParcelDeliveryClientConfig {
  apiKey: string;
  baseUrl: string;
  merchantId?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface CreateDeliveryRequest {
  orderId?: string;
  customerId: string;
  senderName: string;
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  recipientContact: string;
  deliveryWindow?: { start: number; end: number };
  specialInstructions?: string;
  parcel: {
    weightKg: number;
    dimensionsCm: { length: number; width: number; height: number };
    fragile: boolean;
    temperatureControlled: boolean;
    oversized: boolean;
    declaredValue: number;
  };
  shippingPayer?: 'MERCHANT' | 'CUSTOMER' | 'INCLUDED';
  priority?: 'FASTEST' | 'CHEAPEST' | 'SAFEST' | 'CARBON_OPTIMIZED';
  maxBudget?: number;
  preferredCourier?: string;
  deadline?: number;
  insuranceRequired?: boolean;
  signatureRequired?: boolean;
  groupedAllowed?: boolean;
  transitHubsAllowed?: boolean;
  partialDeliveryAllowed?: boolean;
}

export interface DeliveryResponse {
  id: string;
  trackingNumber: string;
  status: string;
  price: { minorUnits: string; currency: string; major: string };
  estimatedArrival?: number;
  courier?: string;
}

export interface TrackingResponse {
  trackingId: string;
  events: Array<{
    status: string;
    detail: string;
    location?: { lat: number; lng: number; address?: string };
    timestamp: number;
  }>;
}

/**
 * The typed Parcel Delivery client. Handles retries, idempotency, and errors.
 *
 *   const client = new ParcelDeliveryClient({ apiKey: '...', baseUrl: 'https://app.payswap.dev' });
 *   const delivery = await client.createDelivery({ ... });
 *   const tracking = await client.trackDelivery(delivery.trackingNumber);
 */
export class ParcelDeliveryClient {
  private config: ParcelDeliveryClientConfig & { maxRetries: number; retryDelayMs: number; timeoutMs: number };

  constructor(config: ParcelDeliveryClientConfig) {
    this.config = {
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
      ...config,
    };
  }

  /** Create a delivery request with automatic retries + idempotency. */
  async createDelivery(request: CreateDeliveryRequest, idempotencyKey?: string): Promise<DeliveryResponse> {
    return this.request('/api/parcel/create', 'POST', request, idempotencyKey);
  }

  /** Cancel a delivery. */
  async cancelDelivery(deliveryId: string, reason: string, idempotencyKey?: string): Promise<{ delivery: DeliveryResponse }> {
    return this.request('/api/parcel/cancel', 'POST', { deliveryId, reason }, idempotencyKey);
  }

  /** Schedule a delivery for a future window. */
  async scheduleDelivery(deliveryId: string, window: { start: number; end: number }): Promise<{ delivery: DeliveryResponse }> {
    return this.request('/api/parcel/schedule', 'POST', { deliveryId, window });
  }

  /** Track a delivery by tracking number. */
  async trackDelivery(trackingNumber: string): Promise<TrackingResponse> {
    return this.request(`/api/parcel/track?trackingId=${trackingNumber}`, 'GET');
  }

  /** Discover grouping opportunities. */
  async discoverGroups(): Promise<{ bundles: unknown[]; count: number }> {
    return this.request('/api/parcel/group', 'POST', {});
  }

  /** Plan a multi-hop route. */
  async planRoute(deliveryIds: string[], priority?: string): Promise<{ route: unknown; message: string }> {
    return this.request('/api/parcel/plan-route', 'POST', { deliveryIds, priority });
  }

  /** Optimize a bundle with wait-time. */
  async optimizeBundle(deliveryIds: string[], maxWaitMinutes?: number): Promise<{ result: unknown; message: string }> {
    return this.request('/api/parcel/optimize-bundle', 'POST', { deliveryIds, maxWaitMinutes });
  }

  /** Submit proof of delivery. */
  async submitProofOfDelivery(deliveryId: string, proof: { photoUrl?: string; signatureUrl?: string; gps?: { lat: number; lng: number } }): Promise<{ delivery: DeliveryResponse }> {
    return this.request('/api/parcel/proof', 'POST', { deliveryId, ...proof });
  }

  /** Rate a delivery. */
  async rateDelivery(deliveryId: string, rating: number, comment?: string): Promise<{ rating: unknown }> {
    return this.request('/api/parcel/rate', 'POST', { deliveryId, rating, comment });
  }

  /** List deliveries. */
  async listDeliveries(): Promise<{ deliveries: DeliveryResponse[]; count: number; stats: unknown }> {
    return this.request('/api/parcel/deliveries', 'GET');
  }

  /** Get dashboard data. */
  async getDashboard(): Promise<{ dashboard: unknown }> {
    return this.request('/api/parcel/dashboard', 'GET');
  }

  /** Verify a webhook signature. */
  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  // ── Internal request handler with retries + idempotency ──
  private async request<T>(path: string, method: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        };
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const res = await fetch(`${this.config.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status >= 500 && attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, this.config.retryDelayMs * Math.pow(2, attempt)));
          continue;
        }

        const data = await res.json();
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return data as T;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, this.config.retryDelayMs * Math.pow(2, attempt)));
          continue;
        }
      }
    }
    throw lastError ?? new Error('Request failed');
  }
}
