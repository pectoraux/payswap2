/**
 * PaySwap TypeScript SDK — HTTP client.
 *
 * `PaySwapClient` is the single entry point for the SDK. Construct it
 * with an API key, then access resource groups via `client.payments`,
 * `client.payouts`, `client.merchants`, etc.
 *
 * Features:
 *   - Automatic idempotency-key generation for POST/PUT/PATCH requests.
 *   - Automatic retry with exponential backoff on retryable errors
 *     (network failures, 409, 429, 5xx).
 *   - Request/response logging via an injectable `PaySwapLogger`.
 *   - Typed error hierarchy — see `./errors.ts`.
 *   - Configurable timeout, fetch implementation, and User-Agent.
 *
 * Example:
 *   ```ts
 *   import { PaySwapClient } from '@payswap/sdk-typescript';
 *   const client = new PaySwapClient({ apiKey: process.env.PAYSWAP_API_KEY! });
 *   const payment = await client.payments.create({
 *     amount: 2900,
 *     currency: 'KES',
 *     method: { type: 'mpesa', mpesa: { phone: '+254700000000' } },
 *   });
 *   console.log(payment.id, payment.status);
 *   ```
 */
import {
  PaySwapError,
  AuthenticationError,
  InvalidRequestError,
  RateLimitError,
  NotFoundError,
  ServerError,
} from './errors';
import type {
  PaySwapClientOptions,
  PaySwapLogEntry,
  PaySwapLogger,
  RequestDescriptor,
  ListParams,
  ListResponse,
  ApiErrorEnvelope,
  CreatePaymentRequest,
  Payment,
  CreatePayoutRequest,
  Payout,
  Merchant,
  UpdateMerchantRequest,
  WebhookEndpoint,
  WebhookDelivery,
  ReplayWebhookRequest,
  Customer,
  CreateCustomerRequest,
  Product,
  CreateProductRequest,
  Invoice,
  CreateInvoiceRequest,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.payswap.io';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const SDK_VERSION = '1.0.0';
const SDK_NAME = '@payswap/sdk-typescript';

// Methods that should auto-receive an idempotency key if one is not supplied.
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random idempotency key. */
function generateIdempotencyKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const len = 32;
  const buf = new Uint8Array(len);
  const g = globalThis as unknown as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return `idemp_${out}`;
}

/** Generate a short request id for log correlation. */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute exponential backoff delay with jitter. */
function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.random() * exp * 0.25;
  return Math.min(maxMs, exp + jitter);
}

/** No-op logger used when the caller doesn't supply one. */
const noopLogger: PaySwapLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

/** Internal HTTP request descriptor. */
interface HttpRequest {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the per-client idempotency behaviour. */
  idempotencyKey?: string;
  /** Override the per-request timeout. */
  timeoutMs?: number;
}

/** Internal HTTP response. */
interface HttpResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
  requestId?: string;
}

/**
 * PaySwapClient is the SDK entry point. Construct it once and reuse it
 * across requests — it is safe to share across concurrent callers.
 */
export class PaySwapClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: PaySwapLogger;
  private readonly userAgent: string;

  /** Payments resource group. */
  readonly payments: PaymentsResource;
  /** Payouts resource group. */
  readonly payouts: PayoutsResource;
  /** Merchants resource group. */
  readonly merchants: MerchantsResource;
  /** Webhooks resource group. */
  readonly webhooks: WebhooksResource;
  /** Customers resource group. */
  readonly customers: CustomersResource;
  /** Products resource group. */
  readonly products: ProductsResource;
  /** Invoices resource group. */
  readonly invoices: InvoicesResource;

  constructor(opts: PaySwapClientOptions) {
    if (!opts || !opts.apiKey) {
      throw new InvalidRequestError('PaySwapClient requires an apiKey', {
        code: 'missing_api_key',
      });
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.logger = opts.logger ?? noopLogger;
    this.userAgent = opts.userAgent ?? `${SDK_NAME}/${SDK_VERSION}`;

    this.payments = new PaymentsResource(this);
    this.payouts = new PayoutsResource(this);
    this.merchants = new MerchantsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.customers = new CustomersResource(this);
    this.products = new ProductsResource(this);
    this.invoices = new InvoicesResource(this);
  }

  /** Sub-resources call this to issue an authenticated request. */
  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const requestId = generateRequestId();
    const method = req.method.toUpperCase();
    let attempt = 0;
    let lastError: PaySwapError | null = null;

    while (attempt <= this.maxRetries) {
      const descriptor: RequestDescriptor = {
        method,
        url: this.buildUrl(req.path, req.query),
        requestId,
        attempt,
      };
      try {
        this.log('debug', 'request start', descriptor, { method, path: req.path });
        const response = await this.doFetch<T>(req, requestId, descriptor.url);
        this.log('debug', 'request ok', descriptor, { status: response.status });
        return response;
      } catch (err) {
        lastError = this.normalizeError(err, requestId);
        if (!lastError.retryable || attempt >= this.maxRetries) {
          this.log('error', 'request failed (no retry)', descriptor, {
            error: lastError.toString(),
          });
          throw lastError;
        }
        const delay = err instanceof RateLimitError && err.retryAfterMs
          ? err.retryAfterMs
          : backoffDelay(attempt);
        this.log('warn', 'request failed (retrying)', descriptor, {
          error: lastError.toString(),
          retryInMs: delay,
          nextAttempt: attempt + 1,
        });
        await sleep(delay);
        attempt += 1;
      }
    }
    // Should be unreachable — the loop either returns or throws.
    throw lastError ?? new ServerError('request loop exited unexpectedly');
  }

  /** Build the absolute URL with query string. */
  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  /** Execute the actual HTTP fetch with timeout. */
  private async doFetch<T>(
    req: HttpRequest,
    requestId: string,
    url: string,
  ): Promise<HttpResponse<T>> {
    const method = req.method.toUpperCase();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'X-PaySwap-Client': `${SDK_NAME}/${SDK_VERSION}`,
      'X-Request-Id': requestId,
      ...(req.headers ?? {}),
    };
    // Auto-idempotency: POST/PUT/PATCH with no explicit key gets one.
    if (IDEMPOTENT_METHODS.has(method)) {
      const key = req.idempotencyKey ?? generateIdempotencyKey();
      headers['Idempotency-Key'] = key;
    }
    const body = req.body !== undefined ? JSON.stringify(req.body) : undefined;
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), req.timeoutMs ?? this.timeoutMs)
      : null;
    try {
      const fetchResp = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller?.signal,
      });
      const respHeaders: Record<string, string> = {};
      fetchResp.headers.forEach((value, key) => {
        respHeaders[key.toLowerCase()] = value;
      });
      const text = await fetchResp.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      const respRequestId = respHeaders['x-request-id'] ?? respHeaders['request-id'];
      const status = fetchResp.status;
      if (status >= 200 && status < 300) {
        return {
          status,
          headers: respHeaders,
          body: parsed as T,
          requestId: respRequestId,
        };
      }
      // Error path: map to typed errors.
      throw this.errorFromStatus(status, parsed, respRequestId);
    } catch (err) {
      if (err instanceof PaySwapError) throw err;
      // Network/abort/timeout errors are retryable.
      const msg = err instanceof Error ? err.message : String(err);
      const aborted =
        err instanceof Error && err.name === 'AbortError';
      throw new ServerError(
        aborted ? `request timed out after ${req.timeoutMs ?? this.timeoutMs}ms` : `network error: ${msg}`,
        { status: 0, code: aborted ? 'timeout' : 'network_error', retryable: true, raw: err },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Map an HTTP status code + envelope to a typed SDK error. */
  private errorFromStatus(status: number, body: unknown, requestId?: string): PaySwapError {
    const env = (body && typeof body === 'object' && 'error' in (body as object)
      ? (body as ApiErrorEnvelope)
      : null) ?? {
      error: {
        type: 'api_error',
        message: `HTTP ${status}`,
      },
    };
    const e = env.error;
    const message = e.message ?? `HTTP ${status}`;
    const code = e.code ?? 'unknown_error';
    const type = e.type ?? 'api_error';
    const retryable = e.retryable ?? status >= 500;
    if (status === 401) {
      return new AuthenticationError(message, { code, requestId, raw: body });
    }
    if (status === 404) {
      return new NotFoundError(message, { code, requestId, raw: body });
    }
    if (status === 429) {
      return new RateLimitError(message, {
        code,
        requestId,
        retryAfterMs: e.retryAfterMs,
        raw: body,
      });
    }
    if (status >= 400 && status < 500) {
      return new InvalidRequestError(message, { code, requestId, retryable, raw: body });
    }
    // Override the type for the InvalidRequestError envelope to match the API.
    const err = new ServerError(message, { status, code, requestId, retryable, raw: body });
    (err as unknown as { type: string }).type = type;
    return err;
  }

  /** Coerce any thrown value into a `PaySwapError`. */
  private normalizeError(err: unknown, requestId: string): PaySwapError {
    if (err instanceof PaySwapError) return err;
    if (err instanceof Error) {
      return new ServerError(err.message, {
        status: 0,
        code: 'unknown_error',
        requestId,
        retryable: false,
        raw: err,
      });
    }
    return new ServerError(`unknown error: ${String(err)}`, {
      status: 0,
      code: 'unknown_error',
      requestId,
      retryable: false,
      raw: err,
    });
  }

  /** Emit a log entry through the configured logger. */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    descriptor: RequestDescriptor,
    fields?: Record<string, unknown>,
  ): void {
    const entry: PaySwapLogEntry = {
      level,
      message,
      ts: Date.now(),
      fields: { ...descriptor, ...(fields ?? {}) },
    };
    this.logger[level](entry);
  }
}

// ---------------------------------------------------------------------------
// Resource groups
// ---------------------------------------------------------------------------

/** Payments resource — `client.payments`. */
export class PaymentsResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Create a new payment. */
  create(params: CreatePaymentRequest): Promise<Payment> {
    return this.client
      .request<Payment>({ method: 'POST', path: '/payments', body: params, idempotencyKey: params.idempotency_key })
      .then((r) => r.body);
  }

  /** Retrieve a payment by id. */
  get(id: string): Promise<Payment> {
    return this.client
      .request<Payment>({ method: 'GET', path: `/payments/${encodeURIComponent(id)}` })
      .then((r) => r.body);
  }

  /** List payments. */
  list(params?: ListParams): Promise<ListResponse<Payment>> {
    return this.client
      .request<ListResponse<Payment>>({ method: 'GET', path: '/payments', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }
}

/** Payouts resource — `client.payouts`. */
export class PayoutsResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Create a new payout. */
  create(params: CreatePayoutRequest): Promise<Payout> {
    return this.client
      .request<Payout>({ method: 'POST', path: '/payouts', body: params, idempotencyKey: params.idempotency_key })
      .then((r) => r.body);
  }

  /** Process (execute) a previously-created payout. */
  process(id: string): Promise<Payout> {
    return this.client
      .request<Payout>({ method: 'POST', path: `/payouts/${encodeURIComponent(id)}/process` })
      .then((r) => r.body);
  }

  /** List payouts. */
  list(params?: ListParams): Promise<ListResponse<Payout>> {
    return this.client
      .request<ListResponse<Payout>>({ method: 'GET', path: '/payouts', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }
}

/** Merchants resource — `client.merchants`. */
export class MerchantsResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Get the current merchant (identified by the API key). */
  get(): Promise<Merchant> {
    return this.client
      .request<Merchant>({ method: 'GET', path: '/merchants/me' })
      .then((r) => r.body);
  }

  /** Update the current merchant. */
  update(params: UpdateMerchantRequest): Promise<Merchant> {
    return this.client
      .request<Merchant>({ method: 'PATCH', path: '/merchants/me', body: params })
      .then((r) => r.body);
  }
}

/** Webhooks resource — `client.webhooks`. */
export class WebhooksResource {
  constructor(private readonly client: PaySwapClient) {}

  /** List webhook deliveries. */
  list(params?: ListParams): Promise<ListResponse<WebhookDelivery>> {
    return this.client
      .request<ListResponse<WebhookDelivery>>({ method: 'GET', path: '/webhooks/deliveries', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }

  /** List configured webhook endpoints. */
  listEndpoints(params?: ListParams): Promise<ListResponse<WebhookEndpoint>> {
    return this.client
      .request<ListResponse<WebhookEndpoint>>({ method: 'GET', path: '/webhooks/endpoints', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }

  /** Replay one or more webhook deliveries. */
  replay(params: ReplayWebhookRequest): Promise<{ replayed: number; deliveries: WebhookDelivery[] }> {
    return this.client
      .request<{ replayed: number; deliveries: WebhookDelivery[] }>({
        method: 'POST',
        path: '/webhooks/replay',
        body: params,
      })
      .then((r) => r.body);
  }
}

/** Customers resource — `client.customers`. */
export class CustomersResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Create a customer. */
  create(params: CreateCustomerRequest): Promise<Customer> {
    return this.client
      .request<Customer>({ method: 'POST', path: '/customers', body: params })
      .then((r) => r.body);
  }

  /** List customers. */
  list(params?: ListParams): Promise<ListResponse<Customer>> {
    return this.client
      .request<ListResponse<Customer>>({ method: 'GET', path: '/customers', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }
}

/** Products resource — `client.products`. */
export class ProductsResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Create a product. */
  create(params: CreateProductRequest): Promise<Product> {
    return this.client
      .request<Product>({ method: 'POST', path: '/products', body: params })
      .then((r) => r.body);
  }

  /** List products. */
  list(params?: ListParams): Promise<ListResponse<Product>> {
    return this.client
      .request<ListResponse<Product>>({ method: 'GET', path: '/products', query: params as Record<string, string | number | boolean | undefined> | undefined })
      .then((r) => r.body);
  }
}

/** Invoices resource — `client.invoices`. */
export class InvoicesResource {
  constructor(private readonly client: PaySwapClient) {}

  /** Create an invoice (in `draft` state). */
  create(params: CreateInvoiceRequest): Promise<Invoice> {
    return this.client
      .request<Invoice>({ method: 'POST', path: '/invoices', body: params })
      .then((r) => r.body);
  }

  /** Send (issue) an invoice — transitions `draft` → `sent`. */
  send(id: string): Promise<Invoice> {
    return this.client
      .request<Invoice>({ method: 'POST', path: `/invoices/${encodeURIComponent(id)}/send` })
      .then((r) => r.body);
  }
}
