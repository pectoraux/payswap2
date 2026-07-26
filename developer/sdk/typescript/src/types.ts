/**
 * PaySwap TypeScript SDK — Request/response types.
 *
 * These types mirror the schemas documented in
 * `developer/openapi/openapi.yaml`. They are intentionally permissive
 * (most fields are optional) so the SDK can evolve alongside the API
 * without breaking callers on every minor change.
 *
 * Money: all amounts are positive integers in the currency's smallest
 * unit (e.g. cents for USD, whole shillings for KES). Currencies are
 * ISO 4217 codes (e.g. `KES`, `USD`, `USDC`).
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** Generic paginated list response. */
export interface ListResponse<T> {
  object: 'list';
  url: string;
  has_more: boolean;
  data: T[];
}

/** Query parameters accepted by all list endpoints. */
export interface ListParams {
  /** Maximum number of records to return (1–100). */
  limit?: number;
  /** Cursor returned by a previous list call. */
  starting_after?: string;
  /** Cursor returned by a previous list call. */
  ending_before?: string;
  /** Filter by creation time (epoch ms). */
  created_gt?: number;
  /** Filter by creation time (epoch ms). */
  created_gte?: number;
  /** Filter by creation time (epoch ms). */
  created_lt?: number;
  /** Filter by creation time (epoch ms). */
  created_lte?: number;
}

/** API error envelope returned by PaySwap. */
export interface ApiErrorEnvelope {
  error: {
    type: string;
    code?: string;
    message?: string;
    param?: string;
    requestId?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentMethod = 'card' | 'mpesa' | 'bank' | 'crypto';
export type PaymentStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface CardDetails {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
}

export interface MpesaDetails {
  phone: string;
  reference?: string;
}

export interface BankDetails {
  bank: string;
  account: string;
  reference?: string;
}

export interface CryptoDetails {
  chain: 'stellar' | 'ethereum' | 'polygon' | 'base';
  address: string;
  asset: string;
}

export interface PaymentMethodDetails {
  type: PaymentMethod;
  card?: CardDetails;
  mpesa?: MpesaDetails;
  bank?: BankDetails;
  crypto?: CryptoDetails;
}

export interface CreatePaymentRequest {
  amount: number;
  currency: string;
  customer?: string;
  customer_details?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  method?: PaymentMethodDetails;
  description?: string;
  reference?: string;
  /** Idempotency key (auto-generated if omitted). */
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
  capture?: boolean;
}

export interface Payment {
  id: string;
  object: 'payment';
  amount: number;
  currency: string;
  status: PaymentStatus;
  customer?: string;
  method?: PaymentMethodDetails;
  description?: string;
  reference?: string;
  captured: boolean;
  refunded_amount: number;
  metadata: Record<string, unknown>;
  created: number;
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export type PayoutStatus =
  | 'pending'
  | 'in_transit'
  | 'paid'
  | 'failed'
  | 'canceled';

export interface CreatePayoutRequest {
  amount: number;
  currency: string;
  destination: {
    type: PaymentMethod;
    phone?: string;
    account?: string;
    bank?: string;
    address?: string;
    chain?: string;
  };
  reference?: string;
  description?: string;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
}

export interface Payout {
  id: string;
  object: 'payout';
  amount: number;
  currency: string;
  status: PayoutStatus;
  destination: {
    type: PaymentMethod;
    phone?: string;
    account?: string;
    bank?: string;
    address?: string;
    chain?: string;
  };
  reference?: string;
  description?: string;
  metadata: Record<string, unknown>;
  created: number;
  arrived_at?: number;
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

export interface Merchant {
  id: string;
  object: 'merchant';
  name: string;
  email: string;
  country: string;
  default_currency: string;
  business_type?: string;
  website?: string;
  metadata: Record<string, unknown>;
  created: number;
}

export interface UpdateMerchantRequest {
  name?: string;
  email?: string;
  default_currency?: string;
  business_type?: string;
  website?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  url: string;
  enabled: boolean;
  events: string[];
  secret: string;
  description?: string;
  created: number;
}

export interface WebhookDelivery {
  id: string;
  object: 'webhook_delivery';
  endpoint_id: string;
  event_type: string;
  status: 'succeeded' | 'failed';
  attempts: number;
  response_code?: number;
  created: number;
}

export interface ReplayWebhookRequest {
  delivery_id?: string;
  event_id?: string;
  /** Replay all failed deliveries in the last N ms. */
  failed_within_ms?: number;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  object: 'customer';
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  metadata: Record<string, unknown>;
  created: number;
}

export interface CreateCustomerRequest {
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  object: 'product';
  name: string;
  description?: string;
  price: number;
  currency: string;
  sku?: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created: number;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  price: number;
  currency: string;
  sku?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  amount: number;
  currency: string;
}

export interface Invoice {
  id: string;
  object: 'invoice';
  number: string;
  customer?: string;
  lines: InvoiceLineItem[];
  amount: number;
  currency: string;
  status: InvoiceStatus;
  due_at?: number;
  sent_at?: number;
  paid_at?: number;
  created: number;
}

export interface CreateInvoiceRequest {
  customer?: string;
  lines: InvoiceLineItem[];
  currency?: string;
  due_at?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

/** Options for constructing a `PaySwapClient`. */
export interface PaySwapClientOptions {
  /** Secret API key (`psk_live_...` or `psk_test_...`). */
  apiKey: string;
  /** Base URL. Defaults to `https://api.payswap.io`. */
  baseUrl?: string;
  /** Request timeout in ms. Defaults to 30000. */
  timeout?: number;
  /** Max retries on retryable errors. Defaults to 3. */
  maxRetries?: number;
  /** Custom fetch implementation (Node 18+ has global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Optional request/response logger. */
  logger?: PaySwapLogger;
  /** SDK name+version stamp sent in `User-Agent`. */
  userAgent?: string;
}

/** A single log entry. */
export interface PaySwapLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  ts: number;
  fields?: Record<string, unknown>;
}

/** Logger interface — implement and pass to `PaySwapClientOptions.logger`. */
export interface PaySwapLogger {
  debug(entry: PaySwapLogEntry): void;
  info(entry: PaySwapLogEntry): void;
  warn(entry: PaySwapLogEntry): void;
  error(entry: PaySwapLogEntry): void;
}

/** Internal request descriptor for the logger. */
export interface RequestDescriptor {
  method: string;
  url: string;
  requestId: string;
  attempt: number;
}
