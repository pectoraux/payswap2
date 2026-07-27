/**
 * PaySwap Protocol — Developer Platform — Barrel Export.
 *
 * Aggregates the developer-platform services that live in the protocol
 * layer:
 *
 *   - Sandbox service      — `sandboxService.{createSandbox,resetSandbox,getSandbox,listSandboxes,seedTestData,...}`
 *   - Mock server          — `mockServerService.{registerMock,getMock,listMocks,setScenario,resolve,...}`
 *   - API usage tracking   — `apiUsageService.{recordRequest,getUsage,getUsageByEndpoint,getUsageStats,getRateLimitStatus,getTopEndpoints,...}`
 *
 * The kernel is FROZEN — this module imports only from intra-package
 * `./sandbox`, `./mock-server`, `./api-usage`. No kernel files are
 * modified.
 */

// Sandbox.
export {
  SandboxService,
  sandboxService,
  type Sandbox,
  type SandboxState,
  type SandboxApiKey,
  type SandboxConnector,
  type SandboxCustomer,
  type SandboxProduct,
  type SandboxPayment,
  type SandboxInvoice,
  type SeedTestDataParams,
} from './sandbox';

// Mock server.
export {
  MockServerService,
  mockServerService,
  registerDefaultMocks,
  type HttpMethod,
  type MockScenario,
  type MockResponse,
  type EndpointKey,
  type MockRegistration,
  type MockResult,
  type MockListItem,
} from './mock-server';

// API usage.
export {
  ApiUsageService,
  apiUsageService,
  DEFAULT_RATE_LIMIT,
  type ApiUsageRecord,
  type TimeRange,
  type ApiUsageStats,
  type EndpointUsage,
  type RateLimitPolicy,
  type RateLimitStatus,
} from './api-usage';
