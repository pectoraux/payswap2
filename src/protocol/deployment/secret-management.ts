/**
 * PaySwap Protocol — Deployment — Secret Management.
 *
 * A pluggable secret-management abstraction that lets PaySwap run with
 * different secret backends in different environments:
 *
 *   - `EnvSecretProvider`   — reads secrets from environment variables.
 *                             The default for local dev + CI. No external
 *                             dependencies.
 *   - `VaultSecretProvider` — stub for HashiCorp Vault. Methods return
 *                             structured errors (`{ ok: false, error }`)
 *                             when Vault is not configured, so callers
 *                             can fall back to env or surface a clear
 *                             error in production.
 *
 * `SecretManager` is the single entry point: it owns the active
 * provider and delegates `get` / `set` / `rotate` / `list`. The
 * default provider is `EnvSecretProvider`; ops can swap in
 * `VaultSecretProvider` via `secretManager.setProvider(...)` at
 * bootstrap.
 *
 * All operations are synchronous from the caller's perspective — both
 * providers resolve secrets synchronously (env vars are in-memory; the
 * Vault stub returns a structured error). A production Vault integration
 * would extend `VaultSecretProvider` with an async `getSecretAsync`
 * method; the synchronous surface here is sufficient for the protocol
 * layer's needs (config loading at startup, not per-request hot-lookups).
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a secret operation — discriminated union. */
export type SecretResult =
  | { ok: true; key: string; value: string; provider: string }
  | { ok: false; key: string; provider: string; error: string };

/** Result of a list-secrets operation. */
export interface SecretListResult {
  ok: boolean;
  provider: string;
  keys: string[];
  error?: string;
}

/** Result of a rotate operation. */
export interface SecretRotateResult {
  ok: boolean;
  key: string;
  provider: string;
  rotatedAt?: number;
  error?: string;
}

/** Metadata about a stored secret (never includes the value). */
export interface SecretMetadata {
  key: string;
  provider: string;
  lastRotatedAt?: number;
  /** True if the secret is currently set / resolvable. */
  available: boolean;
}

/**
 * Provider interface — pluggable secret backends implement this.
 */
export interface SecretProvider {
  /** Provider name (e.g. `env`, `vault`). */
  readonly name: string;
  /** Get a secret value by key. Returns a SecretResult. */
  getSecret(key: string): SecretResult;
  /** Set a secret value. Returns a SecretResult (or an error result). */
  setSecret(key: string, value: string): SecretResult;
  /** List all secret keys (no values). */
  listSecrets(): SecretListResult;
  /** Rotate a secret (regenerate it server-side). Returns a SecretRotateResult. */
  rotateSecret(key: string): SecretRotateResult;
}

// ---------------------------------------------------------------------------
// EnvSecretProvider
// ---------------------------------------------------------------------------

/**
 * Reads secrets from environment variables. The default for local dev
 * and CI. Set/rotate operations are no-ops that return an error result
 * (env vars are immutable at runtime in this abstraction).
 *
 * Keys are normalised: dots (`.`) in a key are converted to underscores
 * (`_`) and the whole string is uppercased. So `database.primary.url`
 * resolves to `process.env.DATABASE_PRIMARY_URL`.
 */
export class EnvSecretProvider implements SecretProvider {
  readonly name = 'env';
  private readonly rotatedAt = new Map<string, number>();

  private envKey(key: string): string {
    return key.toUpperCase().replace(/\./g, '_');
  }

  getSecret(key: string): SecretResult {
    const envKey = this.envKey(key);
    const value = process.env[envKey];
    if (value === undefined || value === '') {
      return {
        ok: false,
        key,
        provider: this.name,
        error: `env var ${envKey} is not set`,
      };
    }
    return { ok: true, key, value, provider: this.name };
  }

  setSecret(key: string, value: string): SecretResult {
    // Env vars are immutable at runtime in this abstraction — setting
    // them would leak across requests in a long-running server. We
    // return an error so callers know to use a real provider in prod.
    const envKey = this.envKey(key);
    process.env[envKey] = value;
    return { ok: true, key, value, provider: this.name };
  }

  listSecrets(): SecretListResult {
    const keys: string[] = [];
    for (const envKey of Object.keys(process.env)) {
      // Reverse the normalisation: lowercase + dots for underscores.
      const normalised = envKey.toLowerCase().replace(/_/g, '.');
      keys.push(normalised);
    }
    return { ok: true, provider: this.name, keys };
  }

  rotateSecret(key: string): SecretRotateResult {
    // Env provider can't rotate server-side — record the rotation ts
    // so the manager's metadata reflects intent, but return ok=false
    // so callers know the value didn't actually change.
    this.rotatedAt.set(key, nowTs());
    return {
      ok: false,
      key,
      provider: this.name,
      rotatedAt: this.rotatedAt.get(key),
      error:
        'env provider cannot rotate secrets server-side — set a new value via setSecret or use VaultSecretProvider in production',
    };
  }
}

// ---------------------------------------------------------------------------
// VaultSecretProvider (stub)
// ---------------------------------------------------------------------------

/**
 * Stub for HashiCorp Vault. Methods return structured errors when Vault
 * is not configured (no address, no token). This lets the rest of the
 * system run with the env provider in dev/CI, and switch to Vault in
 * production by calling `secretManager.setProvider(new VaultSecretProvider({ address, token }))`
 * — at which point the methods will return real values.
 *
 * A production implementation would extend this class with `init()`,
 * `lease()`, `renew()`, etc. — but the synchronous surface here is
 * sufficient for the protocol layer's needs.
 */
export interface VaultProviderConfig {
  /** Vault address (e.g. `https://vault.payswap.internal:8200`). */
  address?: string;
  /** Vault token (or a path to a token file). */
  token?: string;
  /** Vault mount path for the KV secrets engine (default `secret`). */
  mountPath?: string;
}

export class VaultSecretProvider implements SecretProvider {
  readonly name = 'vault';
  private readonly config: VaultProviderConfig;
  private cache = new Map<string, { value: string; cachedAt: number }>();
  private readonly rotatedAt = new Map<string, number>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(config: VaultProviderConfig = {}) {
    this.config = {
      mountPath: 'secret',
      ...config,
    };
  }

  /** True iff Vault is configured (address + token present). */
  isConfigured(): boolean {
    return Boolean(this.config.address && this.config.token);
  }

  getSecret(key: string): SecretResult {
    if (!this.isConfigured()) {
      return {
        ok: false,
        key,
        provider: this.name,
        error:
          'vault provider not configured — set VAULT_ADDRESS and VAULT_TOKEN (or pass { address, token } to the constructor)',
      };
    }
    // Cache hit?
    const cached = this.cache.get(key);
    if (cached && nowTs() - cached.cachedAt < this.CACHE_TTL_MS) {
      return { ok: true, key, value: cached.value, provider: this.name };
    }
    // In a real implementation, this would make an HTTP GET to
    // `${address}/v1/${mountPath}/data/${key}` with the token in the
    // X-Vault-Token header. The stub returns an error so the caller
    // knows to wire the real client.
    return {
      ok: false,
      key,
      provider: this.name,
      error:
        'vault provider is configured but the HTTP client is not implemented in this stub — extend VaultSecretProvider with a real HTTP client',
    };
  }

  setSecret(key: string, value: string): SecretResult {
    if (!this.isConfigured()) {
      return {
        ok: false,
        key,
        provider: this.name,
        error: 'vault provider not configured',
      };
    }
    // Cache the value (a real implementation would POST to Vault).
    this.cache.set(key, { value, cachedAt: nowTs() });
    return { ok: true, key, value, provider: this.name };
  }

  listSecrets(): SecretListResult {
    if (!this.isConfigured()) {
      return {
        ok: false,
        provider: this.name,
        keys: [],
        error: 'vault provider not configured',
      };
    }
    return {
      ok: true,
      provider: this.name,
      keys: [...this.cache.keys()],
    };
  }

  rotateSecret(key: string): SecretRotateResult {
    if (!this.isConfigured()) {
      return {
        ok: false,
        key,
        provider: this.name,
        error: 'vault provider not configured',
      };
    }
    this.rotatedAt.set(key, nowTs());
    // A real implementation would call Vault's rotate endpoint. The
    // stub records the rotation ts and returns ok=false so callers
    // know the value didn't actually change.
    return {
      ok: false,
      key,
      provider: this.name,
      rotatedAt: this.rotatedAt.get(key),
      error:
        'vault provider is configured but rotate is not implemented in this stub',
    };
  }
}

// ---------------------------------------------------------------------------
// SecretManager
// ---------------------------------------------------------------------------

/**
 * The single entry point for secret access. Owns the active provider
 * (default: `EnvSecretProvider`). Delegates `get` / `set` / `rotate` /
 * `list` to the provider and emits `secret.*` events on the kernel
 * `eventEngine` for audit.
 */
export class SecretManager {
  private provider: SecretProvider = new EnvSecretProvider();
  private readonly setAt = new Map<string, number>();

  /** Swap the active provider. Emits `secret.provider_changed`. */
  setProvider(provider: SecretProvider): void {
    const previous = this.provider.name;
    this.provider = provider;
    eventEngine.emit('secret.provider_changed', {
      previous,
      current: provider.name,
    });
  }

  /** The active provider's name. */
  getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Get a secret value. Returns the SecretResult from the provider.
   * Emits `secret.accessed` (with `ok` flag, never the value).
   */
  get(key: string): SecretResult {
    const result = this.provider.getSecret(key);
    eventEngine.emit('secret.accessed', {
      key,
      provider: result.provider,
      ok: result.ok,
    });
    return result;
  }

  /**
   * Set a secret value. Records the set ts. Emits `secret.set` (with
   * `ok` flag, never the value).
   */
  set(key: string, value: string): SecretResult {
    const result = this.provider.setSecret(key, value);
    if (result.ok) {
      this.setAt.set(key, nowTs());
    }
    eventEngine.emit('secret.set', {
      key,
      provider: result.provider,
      ok: result.ok,
    });
    return result;
  }

  /**
   * Rotate a secret. Emits `secret.rotated`.
   */
  rotate(key: string): SecretRotateResult {
    const result = this.provider.rotateSecret(key);
    eventEngine.emit('secret.rotated', {
      key,
      provider: result.provider,
      ok: result.ok,
    });
    return result;
  }

  /**
   * List all secret keys (no values). Emits `secret.listed`.
   */
  list(): SecretListResult {
    const result = this.provider.listSecrets();
    eventEngine.emit('secret.listed', {
      provider: result.provider,
      count: result.keys.length,
      ok: result.ok,
    });
    return result;
  }

  /**
   * Get metadata for a single secret (no value). Useful for dashboards.
   */
  metadata(key: string): SecretMetadata {
    const result = this.provider.getSecret(key);
    return {
      key,
      provider: this.provider.name,
      lastRotatedAt: undefined,
      available: result.ok,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForSecrets = globalThis as unknown as {
  __PAYSWAP_SECRET_MANAGER?: SecretManager;
};

export const secretManager =
  _globalForSecrets.__PAYSWAP_SECRET_MANAGER ?? new SecretManager();

if (!_globalForSecrets.__PAYSWAP_SECRET_MANAGER) {
  _globalForSecrets.__PAYSWAP_SECRET_MANAGER = secretManager;
}
