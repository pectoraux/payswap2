/**
 * Treasury v2 — Reserve alerts.
 *
 * The AlertEngine raises, deduplicates, resolves, and queries `ReserveAlert`s.
 * Alerts are the treasury's "to-do list" — they flag conditions that need
 * operator attention:
 *
 *   - `low_reserve`          : a currency's available reserve is below threshold
 *   - `backing_mismatch`     : Twin Token liabilities exceed reserves
 *   - `mint_limit_exceeded` : a mint was attempted that exceeded a limit
 *   - `freeze_triggered`     : an emergency freeze was put in place
 *   - `rebalance_needed`     : a corridor is below minReserve and needs rebalancing
 *
 * Alerts are deduplicated by (type, target) — raising the same alert twice
 * doesn't create a second record. Once `resolved`, an alert is retained for
 * audit history but no longer appears in `active()`.
 *
 * The alert engine never throws.
 */
import { uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { AlertSeverity, AlertType, ReserveAlert } from './types';
import type { ReserveMonitor } from './reserve';
import type { BackingVerifier } from './backing';
import type { TwinTokenEngine } from '@/protocol/twin-token/engine';
import type { CorridorBalancer } from './balancing';

/** Options for raising an alert. */
export interface RaiseAlertOpts {
  severity: AlertSeverity;
  type: AlertType;
  currency?: string;
  assetCode?: string;
  target?: string; // corridor key, account id, etc.
  message: string;
  ts?: number;
}

/**
 * AlertEngine — singleton-style class.
 */
export class AlertEngine {
  private alerts: Map<string, ReserveAlert> = new Map();
  /** Quick lookup: (type:target) → alert id (for dedup of UNRESOLVED alerts). */
  private activeIndex: Map<string, string> = new Map();
  /** Per-alert-id dedup target (so resolution can clear the active index even
   *  when the target was a corridor key not stored on the alert itself). */
  private targetByAlertId: Map<string, string> = new Map();

  /**
   * Raise an alert. Deduplicates by (type, target) — if an unresolved alert
   * with the same type and target already exists, no new alert is created.
   * Emits a `treasury.alerted` event with the alert payload.
   *
   * Returns the alert (either the newly-raised one or the pre-existing
   * unresolved one).
   */
  raise(opts: RaiseAlertOpts): ReserveAlert {
    const target = opts.target ?? opts.currency ?? opts.assetCode ?? '*';
    const dedupKey = `${opts.type}:${target}`;
    const existingId = this.activeIndex.get(dedupKey);
    if (existingId) {
      const existing = this.alerts.get(existingId);
      if (existing && !existing.resolved) return existing;
    }

    const alert: ReserveAlert = {
      id: uid('alert'),
      severity: opts.severity,
      type: opts.type,
      currency: opts.currency,
      assetCode: opts.assetCode,
      message: opts.message,
      ts: opts.ts ?? Date.now(),
      resolved: false,
    };
    this.alerts.set(alert.id, alert);
    this.activeIndex.set(dedupKey, alert.id);
    this.targetByAlertId.set(alert.id, target);

    eventEngine.emit('treasury.alerted', {
      alertId: alert.id,
      severity: alert.severity,
      type: alert.type,
      currency: alert.currency,
      assetCode: alert.assetCode,
      message: alert.message,
      target,
    }, 0);

    // Specific event types for downstream subscribers.
    eventEngine.emit(`treasury.alerted.${alert.type}`, {
      alertId: alert.id,
      severity: alert.severity,
      currency: alert.currency,
      assetCode: alert.assetCode,
      message: alert.message,
      target,
    }, 0);

    return alert;
  }

  /**
   * Resolve an alert by id. Marks `resolved = true` and removes from the
   * active index so the same (type, target) can be raised again later.
   */
  resolve(alertId: string): ReserveAlert | undefined {
    const alert = this.alerts.get(alertId);
    if (!alert) return undefined;
    if (alert.resolved) return alert;
    alert.resolved = true;
    const target = this.targetByAlertId.get(alertId) ?? alert.currency ?? alert.assetCode ?? '*';
    const dedupKey = `${alert.type}:${target}`;
    // Only clear the active index if it points to THIS alert (not a newer one).
    if (this.activeIndex.get(dedupKey) === alertId) {
      this.activeIndex.delete(dedupKey);
    }
    eventEngine.emit('treasury.alert_resolved', { alertId, type: alert.type }, 0);
    return alert;
  }

  /** All unresolved (active) alerts. */
  active(): ReserveAlert[] {
    return this.all().filter((a) => !a.resolved);
  }

  /** All alerts (active + resolved) — queryable with a filter. */
  all(filter?: {
    type?: AlertType;
    severity?: AlertSeverity;
    assetCode?: string;
    currency?: string;
    resolved?: boolean;
  }): ReserveAlert[] {
    let list = [...this.alerts.values()];
    if (filter?.type) list = list.filter((a) => a.type === filter.type);
    if (filter?.severity) list = list.filter((a) => a.severity === filter.severity);
    if (filter?.assetCode) list = list.filter((a) => a.assetCode === filter.assetCode);
    if (filter?.currency) list = list.filter((a) => a.currency === filter.currency);
    if (filter?.resolved !== undefined) list = list.filter((a) => a.resolved === filter.resolved);
    return list.sort((a, b) => b.ts - a.ts);
  }

  /**
   * Check all reserves and raise `low_reserve` alerts for any currency whose
   * available reserve is below `thresholdMap[currency]`. Returns the list of
   * newly-raised alerts.
   */
  checkReserves(reserveMonitor: ReserveMonitor, thresholdMap: Record<string, number>): ReserveAlert[] {
    const raised: ReserveAlert[] = [];
    for (const [currency, threshold] of Object.entries(thresholdMap)) {
      const r = reserveMonitor.getReserve(currency);
      if (!r) continue;
      if (r.available < threshold) {
        const alert = this.raise({
          severity: r.available < threshold * 0.5 ? 'critical' : 'warning',
          type: 'low_reserve',
          currency,
          assetCode: r.assetCode,
          target: currency,
          message: `${currency} reserve low: ${r.available} < ${threshold} (backing ratio ${r.backingRatio})`,
        });
        raised.push(alert);
      }
    }
    return raised;
  }

  /**
   * Verify backing across all assets and raise `backing_mismatch` alerts for
   * any asset that fails verification. Returns the list of newly-raised alerts.
   */
  checkBacking(
    backingVerifier: BackingVerifier,
    twinTokenEngine: TwinTokenEngine,
    reserveMonitor: ReserveMonitor,
  ): ReserveAlert[] {
    const raised: ReserveAlert[] = [];
    const { results } = backingVerifier.verifyAll(twinTokenEngine, reserveMonitor);
    for (const r of results) {
      if (!r.verified) {
        const alert = this.raise({
          severity: 'critical',
          type: 'backing_mismatch',
          assetCode: r.assetCode,
          target: r.assetCode,
          message: `Backing mismatch for ${r.assetCode}: circulating=${r.circulating}, escrowed=${r.escrowed}, reserve=${r.reserve}, ratio=${r.backingRatio}, discrepancy=${r.discrepancy}`,
        });
        raised.push(alert);
      }
    }
    return raised;
  }

  /**
   * Check all configured corridor targets and raise `rebalance_needed` alerts
   * for any corridor below its `minReserve`.
   */
  checkCorridors(corridorBalancer: CorridorBalancer, reserveMonitor: ReserveMonitor): ReserveAlert[] {
    const raised: ReserveAlert[] = [];
    const underReserved = corridorBalancer.underReserved(reserveMonitor);
    for (const u of underReserved) {
      const alert = this.raise({
        severity: 'warning',
        type: 'rebalance_needed',
        currency: u.corridor.from,
        target: `${u.corridor.from}→${u.corridor.to}`,
        message: `Corridor ${u.corridor.from}→${u.corridor.to} below minReserve: available=${u.available} < min=${u.minReserve}`,
      });
      raised.push(alert);
    }
    return raised;
  }

  /** Reset all state (test helper). */
  reset(): void {
    this.alerts.clear();
    this.activeIndex.clear();
    this.targetByAlertId.clear();
  }
}

/** Singleton alert engine. */
export const alertEngine = new AlertEngine();
