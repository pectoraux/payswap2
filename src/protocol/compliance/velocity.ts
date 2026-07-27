/**
 * PaySwap Protocol — Velocity Monitoring Service.
 *
 * Tracks per-entity transaction count and volume across four rolling
 * windows (1h, 24h, 7d, 30d) and compares against configurable per-
 * entity-type thresholds. Threshold breaches are surfaced as
 * `VelocityRecord[]` via `checkThresholds()` and consumed by `aml.ts`
 * to raise `velocity` alerts.
 *
 * Default thresholds (defined in `types.ts`):
 *   - individual:  $10k / 50 tx per 24h
 *   - merchant:    $100k / 1,000 tx per 24h
 *   - lp:          $1M   / 500 tx per 24h
 *   - business:    $250k / 200 tx per 24h
 *   - treasury:    $100M / 10,000 tx per 24h
 *
 * Thresholds are configurable per entity type via `configureThresholds`.
 */
import { nowTs } from '@/kernel/support';
import {
  DEFAULT_VELOCITY_THRESHOLDS,
  type EntityType,
  type VelocityRecord,
  type VelocityThreshold,
  type VelocityThresholdTable,
  type VelocityWindow,
} from './types';

const WINDOW_MS: Record<VelocityWindow, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const ALL_WINDOWS: VelocityWindow[] = ['1h', '24h', '7d', '30d'];

/** Single transaction entry recorded for an entity. */
interface VelocityTx {
  amount: number;
  ts: number;
}

export class VelocityService {
  private txs = new Map<string, VelocityTx[]>();
  private thresholds: VelocityThresholdTable = JSON.parse(
    JSON.stringify(DEFAULT_VELOCITY_THRESHOLDS),
  );
  /** Per-entity overrides on top of the per-type table. */
  private overrides = new Map<string, VelocityThreshold[]>();

  // ------------------------------------------------------- recordTransaction
  recordTransaction(entityId: string, amount: number): VelocityRecord[] {
    const list = this.txs.get(entityId) ?? [];
    list.push({ amount, ts: nowTs() });
    this.txs.set(entityId, list);
    // Trim anything older than 30d (longest window) to bound memory.
    const cutoff = nowTs() - WINDOW_MS['30d'];
    while (list.length > 0 && list[0].ts < cutoff) list.shift();
    return this.getVelocity(entityId);
  }

  // ------------------------------------------------------- getVelocity
  /** Returns one `VelocityRecord` per window (1h, 24h, 7d, 30d). */
  getVelocity(entityId: string): VelocityRecord[] {
    const list = this.txs.get(entityId) ?? [];
    const now = nowTs();
    const thresholds = this.resolveThresholds(entityId);
    return ALL_WINDOWS.map((window) => {
      const cutoff = now - WINDOW_MS[window];
      let txCount = 0;
      let txVolume = 0;
      let lastTxAt = 0;
      for (const tx of list) {
        if (tx.ts >= cutoff) {
          txCount += 1;
          txVolume += tx.amount;
          if (tx.ts > lastTxAt) lastTxAt = tx.ts;
        }
      }
      const t = thresholds.find((x) => x.window === window);
      const thresholdHit = t
        ? txCount >= t.maxTxCount || txVolume >= t.maxTxVolume
        : false;
      return { entityId, window, txCount, txVolume, lastTxAt, thresholdHit };
    });
  }

  // ------------------------------------------------------- checkThresholds
  /** Returns only the windows where a threshold was hit. */
  checkThresholds(entityId: string): VelocityRecord[] {
    return this.getVelocity(entityId).filter((v) => v.thresholdHit);
  }

  // ------------------------------------------------------- configureThresholds
  configureThresholds(entityType: EntityType, limits: VelocityThreshold[]): void {
    this.thresholds[entityType] = limits.map((l) => ({ ...l }));
  }

  /** Per-entity override (wins over per-type table). */
  configureEntityOverride(entityId: string, limits: VelocityThreshold[]): void {
    this.overrides.set(entityId, limits.map((l) => ({ ...l })));
  }

  /** Thresholds resolved for a given entity (override → type default). */
  resolveThresholds(entityId: string, entityType?: EntityType): VelocityThreshold[] {
    const override = this.overrides.get(entityId);
    if (override) return override;
    return this.thresholds[entityType ?? 'individual'] ?? this.thresholds.individual;
  }

  /** Reset velocity history for an entity (used by tests / audit rebuild). */
  reset(entityId: string): void {
    this.txs.delete(entityId);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForVelocity = globalThis as unknown as { __PAYSWAP_VELOCITY_SERVICE?: VelocityService };
export const velocityService =
  _globalForVelocity.__PAYSWAP_VELOCITY_SERVICE ?? new VelocityService();
if (!_globalForVelocity.__PAYSWAP_VELOCITY_SERVICE) {
  _globalForVelocity.__PAYSWAP_VELOCITY_SERVICE = velocityService;
}
