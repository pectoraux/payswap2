/**
 * PaySwap Protocol — Provider Adapters — Type Definitions.
 *
 * The providers module (`src/protocol/providers/`) extends the
 * `connectors-v2` framework with concrete adapters for real-world
 * banking, payment, custody, compliance, and blockchain RPC providers.
 *
 * Each provider adapter extends `ProductionConnector` from
 * `@/protocol/connectors-v2/base` and therefore inherits:
 *   - idempotency
 *   - rate limiting (token bucket)
 *   - retry with exponential backoff + jitter
 *   - health monitoring
 *   - metrics collection
 *   - audit logging + event emission
 *   - signed Evidence production (kernel-grade)
 *
 * The provider layer is **stateless w.r.t. the protocol** — adapters
 * receive a `ConnectorRequest`, (simulated) execute the operation, and
 * return a `ConnectorResponse` whose `evidence` field is consumed by the
 * planner. Adapters NEVER mutate protocol state directly; they only
 * produce Evidence.
 *
 * The `ConnectorId` union in `connectors-v2/types.ts` is frozen (it
 * lists the 5 original rails). To avoid modifying existing files, we
 * declare our own `ProviderId` / `ProviderType` / `ProviderConfig`
 * types here. The `ProviderConfig` is structurally compatible with
 * `ConnectorConfig` (only the `id`/`type` literals differ) and is
 * coerced via `asConnectorConfig()` when handed to the base class.
 * TypeScript's structural typing + an explicit cast keeps the kernel
 * FROZEN while letting the provider layer carry richer identifiers.
 */
import type { ConnectorConfig } from '@/protocol/connectors-v2/types';

/** Provider identifier — one per concrete adapter. */
export type ProviderId =
  | 'mtn_momo'
  | 'airtel_money'
  | 'stripe'
  | 'flutterwave'
  | 'paystack'
  | 'fireblocks'
  | 'chainalysis'
  | 'trm_labs'
  | 'open_banking_psd2'
  | 'ethereum_rpc'
  | 'polygon_rpc'
  | 'base_rpc'
  | 'stellar_horizon';

/** Coarse classification used by `ProviderRegistry.getByType`. */
export type ProviderType =
  | 'bank'            // Open Banking / PSD2
  | 'mobile_money'    // MTN MoMo, Airtel Money
  | 'psp'             // Stripe, Flutterwave, Paystack
  | 'custody'         // Fireblocks
  | 'compliance'      // Chainalysis KYT, TRM Labs
  | 'blockchain_rpc'; // Ethereum, Polygon, Base, Stellar Horizon

/**
 * Static configuration for a provider adapter instance. Extends the
 * base `ConnectorConfig` shape with provider-specific credentials.
 *
 * All credential fields are optional at the type level — each adapter
 * validates its required credentials lazily on the first authenticated
 * call and returns an `AUTH_FAILED` error if a required field is
 * missing. This makes adapters drop-in ready: the only change required
 * to go from simulated to live is to populate the credentials in the
 * config passed to the constructor (or in environment variables).
 */
export interface ProviderConfig extends Omit<ConnectorConfig, 'id' | 'type'> {
  id: ProviderId;
  type: ProviderType;

  /** Sandbox or production environment tag (provider-specific). */
  environment?: 'sandbox' | 'production' | 'test' | 'live';

  /** Generic API key (Stripe, Chainalysis, Ethereum RPC providers). */
  apiKey?: string;
  /** Secret counterpart to `apiKey` (Flutterwave, Airtel). */
  apiSecret?: string;
  /** MTN MoMo Ocp-Apim-Subscription-Key header. */
  subscriptionKey?: string;
  /** MTN MoMo / Airtel OAuth2 user id (Basic auth). */
  clientId?: string;
  /** MTN MoMo / Airtel OAuth2 password / client secret. */
  clientSecret?: string;
  /** OAuth2 refresh token (PSD2 Open Banking). */
  refreshToken?: string;
  /** Pre-issued access token (skips OAuth2 dance when set). */
  accessToken?: string;
  /** Fireblocks RSA private key (PEM) for request signing. */
  privateKey?: string;
  /** Fireblocks API key id. */
  apiKeyId?: string;
  /** TRM Labs HMAC secret. */
  hmacSecret?: string;
  /** Optional webhook secret hash (Flutterwave). */
  secretHash?: string;
  /** Optional chain id for EVM RPC providers (1=mainnet, 137=polygon, 8453=base). */
  chainId?: number;
}

/**
 * Coerce a `ProviderConfig` into the base `ConnectorConfig` shape.
 * At runtime the underlying object is unchanged — `ProviderId` is a
 * strict subset of `string` and the base class's `ConnectorId`-typed
 * maps/arrays accept any string at runtime (TypeScript unions do not
 * carry runtime type information).
 *
 * This is the ONLY cast in the providers module; it is centrally
 * defined here so the contract is auditable in one place.
 */
export function asConnectorConfig(config: ProviderConfig): ConnectorConfig {
  return config as unknown as ConnectorConfig;
}

/** Common auth-token shape stored by providers that mint OAuth2 tokens. */
export interface AuthToken {
  accessToken: string;
  tokenType: 'Bearer' | 'Basic' | 'Token';
  expiresAt: number; // epoch ms
  scope?: string;
}

/** Result of an `authenticate()` call inside a provider. */
export type AuthResult =
  | { ok: true; token: AuthToken }
  | { ok: false; error: import('@/protocol/connectors-v2/types').ConnectorError };

/** True if the auth token is missing or has expired. */
export function isTokenExpired(token: AuthToken | undefined, skewMs: number = 5_000): boolean {
  if (!token) return true;
  return Date.now() + skewMs >= token.expiresAt;
}

/** Default request timeout (ms) — shared default for all providers. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;

/** Default idempotency cache TTL (ms) — 10 minutes. */
export const DEFAULT_PROVIDER_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

/** Default rate limit characteristics for an external HTTP rail. */
export const DEFAULT_PROVIDER_RPS = 10;
export const DEFAULT_PROVIDER_BURST = 20;
