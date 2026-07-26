/**
 * PaySwap Protocol — Deployment — Feature Flag Service.
 *
 * A lightweight, in-process feature flag service that supports:
 *   - boolean on/off flags,
 *   - per-entity targeting (`targetEntities: string[]`),
 *   - percentage rollouts (`rolloutPct: 0..100`) with deterministic
 *     hash-based bucketing so a given entityId always resolves the same
 *     way across processes,
 *   - named variants (`variants: Record<string, boolean>`) for A/B-style
 *     gates,
 *   - runtime mutation (`set`, `rollout`, `target`) so ops can flip
 *     flags without redeploying.
 *
 * Determinism: `isEnabled(key, entityId?)` hashes `${key}:${entityId}`
 * with FNV-1a and maps the resulting 32-bit integer into [0, 100). If
 * the bucket is strictly less than `rolloutPct`, the flag is on for
 * that entity. Without an `entityId`, the flag is on iff `enabled &&
 * rolloutPct >= 100` (so a partial rollout never accidentally enables
 * a flag for global/anonymous callers).
 *
 * Pre-configured flags (matches the task spec exactly):
 *   - `live_stellar`            — off by default (Stellar mainnet is opt-in).
 *   - `real_connectors`         — off by default (production connectors are opt-in).
 *   - `multi_region`            — off by default (DR multi-region is opt-in).
 *   - `compliance_enforcement`  — on by default (always enforce AML/sanctions).
 *   - `treasury_gates`          — on by default (always enforce pre-mint/pre-burn gates).
 *   - `advanced_analytics`      — on by default (observability always on).
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

/**
 * A single feature flag.
 *
 *  - `key`             — the canonical flag name (snake_case).
 *  - `description`     — human-readable explanation of what the flag gates.
 *  - `enabled`         — global on/off. If `false`, the flag is off for
 *                        everyone regardless of `rolloutPct` / `targetEntities`.
 *  - `variants`        — named variants for A/B-style gating. Each variant
 *                        maps to a boolean. `getVariant(key, entityId)`
 *                        resolves to the variant whose value is true (or
 *                        the first variant if none are true).
 *  - `rolloutPct`      — 0..100. Percentage of entities (by hash bucket)
 *                        for which the flag is on.
 *  - `targetEntities`  — explicit entity ids that always see the flag as
 *                        on (overrides `rolloutPct`).
 *  - `createdAt`       — epoch ms when the flag was first created.
 *  - `updatedAt`       — epoch ms when the flag was last modified.
 */
export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  variants: Record<string, boolean>;
  rolloutPct: number;
  targetEntities: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Default flags
// ---------------------------------------------------------------------------

/**
 * Pre-configured flags shipped with PaySwap. These match the task spec
 * exactly: live_stellar / real_connectors / multi_region are OFF by
 * default (opt-in production capabilities); compliance_enforcement /
 * treasury_gates / advanced_analytics are ON by default (always-on
 * safety + observability).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'live_stellar',
    description:
      'Switch the Stellar chain adapter from simulation mode to live mainnet. Off by default — mainnet is opt-in.',
    enabled: false,
    variants: { simulation: true, live: false },
    rolloutPct: 0,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    key: 'real_connectors',
    description:
      'Switch the production connectors (open banking, M-Pesa, FX, Stellar Horizon, Ethereum RPC) from simulation to live. Off by default — live connectors are opt-in.',
    enabled: false,
    variants: { simulation: true, live: false },
    rolloutPct: 0,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    key: 'multi_region',
    description:
      'Enable multi-region active-active replication. Off by default — single-region until DR is fully wired.',
    enabled: false,
    variants: { single_region: true, multi_region: false },
    rolloutPct: 0,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    key: 'compliance_enforcement',
    description:
      'Enforce AML / sanctions / KYC / travel-rule checks on every payment. On by default — never disable in production.',
    enabled: true,
    variants: { enforced: true, bypassed: false },
    rolloutPct: 100,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    key: 'treasury_gates',
    description:
      'Enforce treasury pre-mint / pre-burn / backing-mismatch gates. On by default — never disable in production.',
    enabled: true,
    variants: { enforced: true, bypassed: false },
    rolloutPct: 100,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    key: 'advanced_analytics',
    description:
      'Enable observability: distributed tracing, business KPIs, payment / settlement / connector analytics, real-time dashboard. On by default.',
    enabled: true,
    variants: { enabled: true, disabled: false },
    rolloutPct: 100,
    targetEntities: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

// ---------------------------------------------------------------------------
// Hashing (FNV-1a, deterministic across processes)
// ---------------------------------------------------------------------------

/**
 * Compute a 32-bit FNV-1a hash of the input string. Deterministic —
 * the same input always produces the same hash, across processes,
 * across Node.js versions, across regions. Used for percentage
 * rollout bucketing.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5; // 2166136261 (FNV offset basis)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime (16777619) with 32-bit overflow.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Compute the bucket [0, 100) for a (key, entityId) pair. The same pair
 * always resolves to the same bucket across processes.
 */
function bucketForKey(key: string, entityId: string): number {
  return fnv1aHash(`${key}:${entityId}`) % 100;
}

// ---------------------------------------------------------------------------
// FeatureFlagService
// ---------------------------------------------------------------------------

/**
 * Feature flag service. Owns the canonical flag map and exposes
 * `isEnabled` / `getVariant` for runtime gating, plus `set` / `rollout`
 * / `target` for ops-driven mutation.
 *
 * Singleton via `globalThis.__PAYSWAP_FEATURE_FLAGS` so Next.js dev-mode
 * module re-instantiation cannot create duplicate flag maps.
 */
export class FeatureFlagService {
  private flags = new Map<string, FeatureFlag>();

  constructor() {
    for (const flag of DEFAULT_FEATURE_FLAGS) {
      const ts = nowTs();
      this.flags.set(flag.key, {
        ...flag,
        variants: { ...flag.variants },
        targetEntities: [...flag.targetEntities],
        createdAt: ts,
        updatedAt: ts,
      });
    }
  }

  /**
   * Set (create or update) a flag. Emits `feature_flag.set`.
   */
  set(flag: FeatureFlag): FeatureFlag {
    const ts = nowTs();
    const existing = this.flags.get(flag.key);
    const next: FeatureFlag = {
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      variants: { ...flag.variants },
      rolloutPct: Math.max(0, Math.min(100, flag.rolloutPct)),
      targetEntities: [...flag.targetEntities],
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    this.flags.set(flag.key, next);
    eventEngine.emit('feature_flag.set', {
      key: next.key,
      enabled: next.enabled,
      rolloutPct: next.rolloutPct,
      targetEntities: next.targetEntities,
    });
    return next;
  }

  /**
   * Is the flag enabled for the given entity?
   *
   * Decision tree (first match wins):
   *   1. Flag missing → false.
   *   2. `entityId` is in `targetEntities` → true (explicit override,
   *      works even when `enabled` is false — this is the partial-rollout
   *      / internal-testing pattern).
   *   3. `enabled === false` → false (global kill switch).
   *   4. `entityId` is provided AND `rolloutPct >= 100` → true.
   *   5. `entityId` is provided AND bucket(key, entityId) < rolloutPct → true.
   *   6. `entityId` is undefined → true only if rolloutPct >= 100 (so a
   *      partial rollout never accidentally enables a flag for global/
   *      anonymous callers).
   *   7. Otherwise → false.
   */
  isEnabled(key: string, entityId?: string): boolean {
    const flag = this.flags.get(key);
    if (!flag) return false;
    // Targeted entities always see the flag as on (override the global
    // kill switch too — this is the internal-testing pattern).
    if (entityId && flag.targetEntities.includes(entityId)) return true;
    if (!flag.enabled) return false;
    if (flag.rolloutPct >= 100) return true;
    if (entityId === undefined) return false;
    return bucketForKey(key, entityId) < flag.rolloutPct;
  }

  /**
   * Resolve the active variant name for the given entity. Returns the
   * first variant whose value is `true`. If none is true, returns the
   * first variant name (so callers always get a non-empty string).
   *
   * If the flag is disabled or missing, returns `'off'`.
   */
  getVariant(key: string, entityId?: string): string {
    const flag = this.flags.get(key);
    if (!flag) return 'off';
    const on = this.isEnabled(key, entityId);
    if (!on) return 'off';
    const variantNames = Object.keys(flag.variants);
    if (variantNames.length === 0) return 'on';
    for (const name of variantNames) {
      if (flag.variants[name]) return name;
    }
    return variantNames[0];
  }

  /**
   * Set the rollout percentage for a flag. Clamped to [0, 100].
   * Emits `feature_flag.rollout`.
   */
  rollout(key: string, pct: number): FeatureFlag | null {
    const flag = this.flags.get(key);
    if (!flag) return null;
    const clamped = Math.max(0, Math.min(100, pct));
    const next: FeatureFlag = {
      ...flag,
      variants: { ...flag.variants },
      targetEntities: [...flag.targetEntities],
      rolloutPct: clamped,
      updatedAt: nowTs(),
    };
    this.flags.set(key, next);
    eventEngine.emit('feature_flag.rollout', { key, rolloutPct: clamped });
    return next;
  }

  /**
   * Target specific entities (always-on for them, regardless of
   * rolloutPct). Replaces the existing target list. Emits
   * `feature_flag.target`.
   */
  target(key: string, entityIds: string[]): FeatureFlag | null {
    const flag = this.flags.get(key);
    if (!flag) return null;
    const next: FeatureFlag = {
      ...flag,
      variants: { ...flag.variants },
      targetEntities: [...entityIds],
      updatedAt: nowTs(),
    };
    this.flags.set(key, next);
    eventEngine.emit('feature_flag.target', { key, targetEntities: next.targetEntities });
    return next;
  }

  /**
   * All flags (snapshot, most-recent-first by updatedAt).
   */
  getAll(): FeatureFlag[] {
    return [...this.flags.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((f) => ({
        ...f,
        variants: { ...f.variants },
        targetEntities: [...f.targetEntities],
      }));
  }

  /**
   * Get a single flag (snapshot) by key, or null if missing.
   */
  get(key: string): FeatureFlag | null {
    const flag = this.flags.get(key);
    if (!flag) return null;
    return {
      ...flag,
      variants: { ...flag.variants },
      targetEntities: [...flag.targetEntities],
    };
  }

  /**
   * Reset all flags to the default configuration. Emits
   * `feature_flag.reset`.
   */
  reset(): void {
    this.flags.clear();
    for (const flag of DEFAULT_FEATURE_FLAGS) {
      const ts = nowTs();
      this.flags.set(flag.key, {
        ...flag,
        variants: { ...flag.variants },
        targetEntities: [...flag.targetEntities],
        createdAt: ts,
        updatedAt: ts,
      });
    }
    eventEngine.emit('feature_flag.reset', { count: this.flags.size });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForFlags = globalThis as unknown as {
  __PAYSWAP_FEATURE_FLAGS?: FeatureFlagService;
};

export const featureFlags =
  _globalForFlags.__PAYSWAP_FEATURE_FLAGS ?? new FeatureFlagService();

if (!_globalForFlags.__PAYSWAP_FEATURE_FLAGS) {
  _globalForFlags.__PAYSWAP_FEATURE_FLAGS = featureFlags;
}
