/**
 * Extension Platform — SDK.
 *
 * The developer-facing API. Developers write:
 *
 *   export default defineExtension({
 *     manifest: { ... },
 *     setup(ctx) { ... },
 *     capabilities: { ... },
 *   })
 *
 * The SDK provides typed access to platform systems: payments, wallet, money,
 * resolve(), events, tokens, providers, storage, identity, logging, scheduling.
 */

import type { ExtensionManifestV2, PermissionRequest } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// defineExtension() — the entry point
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtensionContext {
  /** The extension id. */
  extensionId: string;
  /** The tenant (organization) id. */
  tenantId: string;
  /** Approved permissions. */
  permissions: PermissionRequest[];

  // ── Platform APIs ──
  payments: PaymentsAPI;
  wallet: WalletAPI;
  money: MoneyAPI;
  resolve: ResolveAPI;
  events: EventsAPI;
  tokens: TokensAPI;
  providers: ProvidersAPI;
  storage: StorageAPI;
  identity: IdentityAPI;
  logging: LoggingAPI;
  scheduling: SchedulingAPI;
  graph: GraphAPI;
}

export interface ExtensionDefinition {
  manifest: ExtensionManifestV2;
  setup?: (ctx: ExtensionContext) => void | Promise<void>;
  /** Capability handlers — invoked when the planner routes a proof through this extension. */
  capabilities?: Record<string, (inputs: Record<string, unknown>, ctx: ExtensionContext) => Promise<unknown>>;
  /** Health check handlers. */
  healthChecks?: Record<string, (ctx: ExtensionContext) => Promise<{ healthy: boolean; detail: string }>>;
  /** Scheduled job handlers. */
  scheduledJobs?: Record<string, (ctx: ExtensionContext) => Promise<void>>;
}

/**
 * Define an extension. This is the developer's entry point.
 *
 *   export default defineExtension({
 *     manifest: { id: 'parcel-delivery', name: 'Parcel Delivery', ... },
 *     setup(ctx) { ctx.logging.info('Parcel Delivery ready'); },
 *     capabilities: {
 *       'ship_parcel': async (inputs, ctx) => { ... },
 *     },
 *   })
 */
export function defineExtension(def: ExtensionDefinition): ExtensionDefinition {
  // In production, this would validate the manifest, register the extension,
  // and return a handle. For the SDK, we just return the definition.
  return def;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM APIs — typed interfaces to platform systems
// ═══════════════════════════════════════════════════════════════════════════

export interface PaymentsAPI {
  /** Create a payment intent. */
  createPayment(input: { amount: number; currency: string; customerId?: string; description?: string }): Promise<{ paymentId: string; status: string }>;
  /** Get payment status. */
  getPayment(paymentId: string): Promise<{ status: string; amount: number; currency: string }>;
  /** Refund a payment. */
  refund(paymentId: string, amount?: number): Promise<{ refundId: string; status: string }>;
}

export interface WalletAPI {
  /** Get wallet balance. */
  getBalance(walletId: string): Promise<{ balance: number; currency: string }>;
  /** Transfer between wallets. */
  transfer(from: string, to: string, amount: number, currency: string): Promise<{ transferId: string; status: string }>;
}

export interface MoneyAPI {
  /** Create an exact Money value (BigInt, no float). */
  fromMajor(amount: number | string, currency: string): import('@/money').Money;
  fromMinor(minor: bigint | number | string, currency: string): import('@/money').Money;
  zero(currency?: string): import('@/money').Money;
}

export interface ResolveAPI {
  /** The universal resolve() — prove a goal, get proofs + certificate. */
  resolve(goal: string | { dsl: string }, constraints?: Record<string, unknown>): Promise<{
    proofs: unknown[];
    best: unknown;
    certificate?: unknown;
    simulation?: unknown;
  }>;
}

export interface EventsAPI {
  /** Emit an event to the economic event bus. */
  emit(type: string, payload: Record<string, unknown>): Promise<void>;
  /** Subscribe to events. */
  subscribe(eventType: string, handler: (event: unknown) => void | Promise<void>): () => void;
}

export interface TokensAPI {
  /** Mint a token (requires tokens:write permission). */
  mint(tokenId: string, to: string, amount: number, reason: string): Promise<{ operationId: string }>;
  /** Burn a token. */
  burn(tokenId: string, from: string, amount: number, reason: string): Promise<{ operationId: string }>;
  /** Get token balance. */
  getBalance(tokenId: string, holderId: string): Promise<{ balance: number }>;
}

export interface ProvidersAPI {
  /** Register this extension as a provider in the EKG. */
  registerProvider(provider: { id: string; name: string; label: string; capabilities: string[]; jurisdictions: string[] }): Promise<void>;
  /** Invoke another provider's capability. */
  invoke(providerId: string, capabilityId: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface StorageAPI {
  /** Store data (scoped to this extension + tenant). */
  set(key: string, value: unknown): Promise<void>;
  /** Retrieve data. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Delete data. */
  delete(key: string): Promise<void>;
  /** List keys with a prefix. */
  list(prefix: string): Promise<string[]>;
}

export interface IdentityAPI {
  /** Verify an identity (requires identity:write permission). */
  verifyIdentity(userId: string, method: string): Promise<{ verified: boolean; credentialId?: string }>;
  /** Get identity credentials for a user. */
  getCredentials(userId: string): Promise<{ credentials: unknown[] }>;
}

export interface LoggingAPI {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SchedulingAPI {
  /** Schedule a recurring job. */
  schedule(jobId: string, cron: string, handler: () => void | Promise<void>): Promise<void>;
  /** Schedule a one-time delayed execution. */
  delay(jobId: string, delayMs: number, handler: () => void | Promise<void>): Promise<void>;
}

export interface GraphAPI {
  /** Query the EKG. */
  query(filter: { kind?: string; label?: string }): Promise<unknown[]>;
  /** Add a node to the EKG. */
  addNode(kind: string, label: string, properties?: Record<string, unknown>): Promise<string>;
  /** Traverse relationships. */
  traverse(fromId: string, relType: string): Promise<unknown[]>;
}
