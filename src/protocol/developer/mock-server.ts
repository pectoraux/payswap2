/**
 * PaySwap Protocol — Developer Platform — Mock Server.
 *
 * Lets developers register canned responses for any PaySwap REST endpoint
 * and switch them between named scenarios (`success`, `error`, `timeout`,
 * `slow`, `partial`) without touching live infrastructure. The MockServer
 * ships pre-registered mocks for every PaySwap API endpoint so a
 * developer can hit the ground running.
 *
 * Usage:
 *   - `registerMock(endpoint, response)` — register a canned response.
 *   - `getMock(endpoint)`                — fetch the current mock for an
 *                                          endpoint (or `undefined`).
 *   - `listMocks()`                      — list every registered mock.
 *   - `setScenario(endpoint, scenario)`  — switch an endpoint to a named
 *                                          scenario (success / error /
 *                                          timeout / slow / partial).
 *   - `resolve(endpoint)`                — execute the current scenario and
 *                                          return a `MockResult` describing
 *                                          what the caller should do (e.g.
 *                                          delay, then return body).
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`. No kernel files are modified.
 */
import { uid, nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** HTTP methods accepted by the mock server. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Named scenario presets. */
export type MockScenario = 'success' | 'error' | 'timeout' | 'slow' | 'partial';

/** A canned HTTP response. */
export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Optional artificial latency in milliseconds. */
  delayMs?: number;
  /** If `true`, the mock server should hang instead of responding (timeout). */
  timeout?: boolean;
}

/** An endpoint key — method + path. */
export interface EndpointKey {
  method: HttpMethod;
  path: string;
}

/** A registered mock for an endpoint. */
export interface MockRegistration {
  id: string;
  endpoint: EndpointKey;
  /** Default response (used when scenario is `success`). */
  defaultResponse: MockResponse;
  /** Per-scenario overrides. */
  scenarios: Partial<Record<MockScenario, MockResponse>>;
  /** Currently active scenario. Defaults to `success`. */
  activeScenario: MockScenario;
  createdAt: number;
  updatedAt: number;
}

/** Result of `resolve(endpoint)` — instructions to the caller. */
export interface MockResult {
  endpoint: EndpointKey;
  scenario: MockScenario;
  /** Delay (ms) the caller should wait before responding. */
  delayMs: number;
  /** If `true`, the caller should never respond (simulate timeout). */
  timeout: boolean;
  /** HTTP status code to return. */
  status: number;
  /** Response headers. */
  headers: Record<string, string>;
  /** Response body. */
  body: unknown;
  /** Matched mock id (or null if no mock registered). */
  mockId: string | null;
  /** Resolution timestamp. */
  resolvedAt: number;
}

/** List item returned from `listMocks()`. */
export interface MockListItem {
  id: string;
  method: HttpMethod;
  path: string;
  activeScenario: MockScenario;
  scenarios: MockScenario[];
  defaultStatus: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function endpointKey(method: HttpMethod, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function scenarioOrDefault(
  reg: MockRegistration,
  scenario: MockScenario,
): MockResponse {
  return reg.scenarios[scenario] ?? reg.defaultResponse;
}

// ---------------------------------------------------------------------------
// MockServerService
// ---------------------------------------------------------------------------

/**
 * MockServerService owns the in-memory mock registry. Endpoints are keyed
 * by `METHOD path`; path matching is exact — callers should normalise
 * path parameters before lookup (e.g. `/payments/pay_123` → `/payments/{id}`).
 */
export class MockServerService {
  private mocks = new Map<string, MockRegistration>();

  /**
   * Register (or replace) a mock for an endpoint. The default scenario is
   * `success`.
   */
  registerMock(
    endpoint: EndpointKey,
    response: MockResponse,
    scenarios: Partial<Record<MockScenario, MockResponse>> = {},
  ): MockRegistration {
    const key = endpointKey(endpoint.method, endpoint.path);
    const ts = nowTs();
    const existing = this.mocks.get(key);
    const reg: MockRegistration = {
      id: existing?.id ?? uid('mock'),
      endpoint,
      defaultResponse: response,
      scenarios,
      activeScenario: existing?.activeScenario ?? 'success',
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    this.mocks.set(key, reg);
    return reg;
  }

  /** Get the current registration for an endpoint, or `undefined`. */
  getMock(endpoint: EndpointKey): MockRegistration | undefined {
    return this.mocks.get(endpointKey(endpoint.method, endpoint.path));
  }

  /** Remove a mock registration. */
  unregisterMock(endpoint: EndpointKey): boolean {
    return this.mocks.delete(endpointKey(endpoint.method, endpoint.path));
  }

  /** List all registered mocks (without the full response payloads). */
  listMocks(): MockListItem[] {
    const out: MockListItem[] = [];
    for (const reg of this.mocks.values()) {
      out.push({
        id: reg.id,
        method: reg.endpoint.method,
        path: reg.endpoint.path,
        activeScenario: reg.activeScenario,
        scenarios: Object.keys(reg.scenarios) as MockScenario[],
        defaultStatus: reg.defaultResponse.status,
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Switch an endpoint to a named scenario. */
  setScenario(endpoint: EndpointKey, scenario: MockScenario): MockRegistration {
    const key = endpointKey(endpoint.method, endpoint.path);
    const reg = this.mocks.get(key);
    if (!reg) throw new Error(`no mock registered for ${key}`);
    reg.activeScenario = scenario;
    reg.updatedAt = nowTs();
    return reg;
  }

  /**
   * Resolve the current mock for an endpoint into an actionable result.
   * If no mock is registered, returns a 404 result.
   */
  resolve(endpoint: EndpointKey): MockResult {
    const reg = this.mocks.get(endpointKey(endpoint.method, endpoint.path));
    const resolvedAt = nowTs();
    if (!reg) {
      return {
        endpoint,
        scenario: 'error',
        delayMs: 0,
        timeout: false,
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: {
          error: {
            type: 'not_found',
            code: 'mock_not_registered',
            message: `No mock registered for ${endpoint.method} ${endpoint.path}`,
          },
        },
        mockId: null,
        resolvedAt,
      };
    }
    const resp = scenarioOrDefault(reg, reg.activeScenario);
    return {
      endpoint: reg.endpoint,
      scenario: reg.activeScenario,
      delayMs: resp.delayMs ?? 0,
      timeout: resp.timeout ?? false,
      status: resp.status,
      headers: resp.headers ?? { 'content-type': 'application/json' },
      body: resp.body,
      mockId: reg.id,
      resolvedAt,
    };
  }

  /** Total number of registered mocks (for ops/diagnostics). */
  count(): number {
    return this.mocks.size;
  }
}

// ---------------------------------------------------------------------------
// Pre-registered mocks for all PaySwap API endpoints
// ---------------------------------------------------------------------------

/**
 * The default body templates used by the pre-registered mocks. These mirror
 * the canonical PaySwap response shapes documented in the OpenAPI spec.
 */
function defaultSuccessBody(path: string): unknown {
  if (path.endsWith('/payments')) {
    return {
      object: 'list',
      url: path,
      has_more: false,
      data: [
        {
          id: 'pay_test_0001',
          object: 'payment',
          amount: 2900,
          currency: 'KES',
          status: 'succeeded',
          customer: 'cust_test_0001',
          created: Math.floor(nowTs() / 1000),
        },
      ],
    };
  }
  if (path.startsWith('/payments/')) {
    return {
      id: 'pay_test_0001',
      object: 'payment',
      amount: 2900,
      currency: 'KES',
      status: 'succeeded',
      customer: 'cust_test_0001',
      created: Math.floor(nowTs() / 1000),
    };
  }
  if (path === '/payouts') {
    return {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'po_test_0001',
          object: 'payout',
          amount: 50000,
          currency: 'KES',
          status: 'pending',
          created: Math.floor(nowTs() / 1000),
        },
      ],
    };
  }
  if (path.startsWith('/payouts/')) {
    return {
      id: 'po_test_0001',
      object: 'payout',
      amount: 50000,
      currency: 'KES',
      status: 'pending',
      created: Math.floor(nowTs() / 1000),
    };
  }
  if (path === '/merchants/me') {
    return {
      id: 'mch_test_0001',
      object: 'merchant',
      name: 'Test Merchant',
      country: 'KE',
      defaultCurrency: 'KES',
      created: Math.floor(nowTs() / 1000),
    };
  }
  if (path === '/webhooks/endpoints') {
    return {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'we_test_0001',
          object: 'webhook_endpoint',
          url: 'https://example.com/webhooks/payswap',
          enabled: true,
          events: ['payment.succeeded', 'payout.paid'],
        },
      ],
    };
  }
  if (path === '/customers') {
    return {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'cust_test_0001',
          object: 'customer',
          name: 'Alice Wanjiru',
          email: 'alice@example.com',
          country: 'KE',
        },
      ],
    };
  }
  if (path === '/products') {
    return {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'prod_test_0001',
          object: 'product',
          name: 'Pro Plan',
          price: 2900,
          currency: 'KES',
        },
      ],
    };
  }
  if (path === '/invoices') {
    return {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'inv_test_0001',
          object: 'invoice',
          number: 'INV-2025-0001',
          amount: 5000,
          currency: 'KES',
          status: 'paid',
        },
      ],
    };
  }
  if (path === '/ledger/trial-balance') {
    return {
      object: 'trial_balance',
      asOf: nowTs(),
      accounts: [
        { code: '1000', name: 'Cash', debit: 1_000_000, credit: 0 },
        { code: '2000', name: 'Accounts Payable', debit: 0, credit: 250_000 },
        { code: '3000', name: 'Equity', debit: 0, credit: 750_000 },
      ],
      totals: { debit: 1_000_000, credit: 1_000_000 },
    };
  }
  if (path === '/ops/health') {
    return {
      status: 'ok',
      version: '1.0.0',
      uptime: 3661,
      checks: {
        api: 'ok',
        ledger: 'ok',
        connectors: 'ok',
        treasury: 'ok',
      },
    };
  }
  if (path === '/ops/metrics') {
    return '# PaySwap metrics (mock)\n' + 'payswap_payments_total 1234\n';
  }
  if (path.startsWith('/compliance/screen')) {
    return {
      screened: true,
      hits: [],
      score: 0,
      recommendation: 'clear',
      checkedAt: nowTs(),
    };
  }
  if (path === '/treasury/status') {
    return {
      positions: [
        { currency: 'KES', balance: 12_000_000 },
        { currency: 'USDC', balance: 50_000 },
      ],
      health: 'healthy',
      asOf: nowTs(),
    };
  }
  return { object: 'mock', ok: true };
}

/** Build the standard scenario overrides for a path. */
function defaultScenarios(
  path: string,
): Partial<Record<MockScenario, MockResponse>> {
  return {
    error: {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: {
        error: {
          type: 'invalid_request_error',
          code: 'mock_forced_error',
          message: `Mock forced error for ${path}`,
        },
      },
    },
    timeout: {
      status: 0,
      timeout: true,
      body: null,
    },
    slow: {
      status: 200,
      delayMs: 2500,
      headers: { 'content-type': 'application/json' },
      body: defaultSuccessBody(path),
    },
    partial: {
      status: 207,
      headers: { 'content-type': 'application/json' },
      body: {
        object: 'partial',
        ok: true,
        warnings: ['Some sub-operations failed (mock scenario=partial).'],
      },
    },
  };
}

/**
 * Catalogue of every PaySwap REST endpoint, used to pre-register mocks.
 * Keep this in sync with `developer/openapi/openapi.yaml`.
 */
const PRE_REGISTERED_ENDPOINTS: Array<[HttpMethod, string]> = [
  // Payments
  ['GET', '/payments'],
  ['POST', '/payments'],
  ['GET', '/payments/{id}'],
  ['POST', '/payments/{id}/refund'],
  ['POST', '/payments/{id}/capture'],
  // Payouts
  ['GET', '/payouts'],
  ['POST', '/payouts'],
  ['GET', '/payouts/{id}'],
  ['POST', '/payouts/{id}/process'],
  ['POST', '/payouts/{id}/cancel'],
  // Merchants
  ['GET', '/merchants/me'],
  ['PATCH', '/merchants/me'],
  // Webhooks
  ['GET', '/webhooks/endpoints'],
  ['POST', '/webhooks/endpoints'],
  ['POST', '/webhooks/{id}/replay'],
  // Customers
  ['GET', '/customers'],
  ['POST', '/customers'],
  ['GET', '/customers/{id}'],
  // Products
  ['GET', '/products'],
  ['POST', '/products'],
  // Invoices
  ['GET', '/invoices'],
  ['POST', '/invoices'],
  ['POST', '/invoices/{id}/send'],
  // Compliance
  ['POST', '/compliance/screen'],
  ['GET', '/compliance/audit-export'],
  // Treasury
  ['GET', '/treasury/status'],
  ['GET', '/treasury/positions'],
  // Ledger
  ['GET', '/ledger/trial-balance'],
  ['POST', '/ledger/reconciliation'],
  ['GET', '/ledger/accounts'],
  // Ops
  ['GET', '/ops/health'],
  ['GET', '/ops/metrics'],
  ['GET', '/ops/overview'],
];

/**
 * Pre-register mocks for every PaySwap endpoint. Safe to call multiple
 * times — existing registrations are left untouched.
 */
export function registerDefaultMocks(svc: MockServerService = mockServerService): void {
  for (const [method, path] of PRE_REGISTERED_ENDPOINTS) {
    const key = endpointKey(method, path);
    if ((svc as unknown as { mocks: Map<string, unknown> }).mocks?.has(key)) continue;
    svc.registerMock(
      { method, path },
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: defaultSuccessBody(path),
      },
      defaultScenarios(path),
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _g = globalThis as unknown as {
  __PAYSWAP_MOCK_SERVER_SERVICE?: MockServerService;
};
export const mockServerService: MockServerService =
  _g.__PAYSWAP_MOCK_SERVER_SERVICE ?? new MockServerService();
if (!_g.__PAYSWAP_MOCK_SERVER_SERVICE) {
  _g.__PAYSWAP_MOCK_SERVER_SERVICE = mockServerService;
  // Pre-register the full PaySwap endpoint catalogue on first instantiation.
  registerDefaultMocks(mockServerService);
}
