/**
 * PaySwap Protocol — Disaster Recovery — RPO / RTO Monitor.
 *
 * RPO (Recovery Point Objective) and RTO (Recovery Time Objective) are
 * the two canonical DR metrics:
 *
 *  - RPO = the maximum tolerable data loss, measured as the time
 *          between the latest durable event and the disaster moment.
 *          PaySwap's target is **RPO < 60s** — at most one minute of
 *          event data loss in a failover.
 *  - RTO = the maximum tolerable recovery time, measured as the
 *          wall-clock time from disaster detection to full service
 *          restoration. PaySwap's target is **RTO < 300s** — at most
 *          five minutes of downtime.
 *
 * This monitor records:
 *   - the latest event timestamp (via `recordEventTime(ts)` — usually
 *     wired to the kernel event bus),
 *   - the start + end of a recovery operation (via
 *     `recordRecoveryStart()` / `recordRecoveryEnd()`),
 * and produces an `RPO_RTO_Measurement`:
 *   - `rpoMs = now - latestEventTs`
 *   - `rtoMs = recoveryEnd - recoveryStart`
 *   - `compliant = rpoMs <= targetRpo && rtoMs <= targetRto`
 *
 * The monitor keeps a rolling history of measurements (default 1_000
 * points) so dashboards can plot RPO/RTO over time.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.rpo_rto_measured` — after each `measure()` call.
 *  - `dr.rpo_rto_violation` — when a measurement is non-compliant.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No
 * kernel files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';
import type { RPO_RTO_Measurement } from './types';
import { DEFAULT_TARGET_RPO_MS, DEFAULT_TARGET_RTO_MS } from './types';

/**
 * RPO / RTO monitor.
 *
 * Use:
 *   - `rpoRtoMonitor.attach()` — auto-record the timestamp of every
 *      kernel event.
 *   - `rpoRtoMonitor.recordRecoveryStart()` / `.recordRecoveryEnd()`
 *      — bracket a recovery operation.
 *   - `rpoRtoMonitor.measure()` — produce a measurement.
 *   - `rpoRtoMonitor.isCompliant()` — boolean compliance check.
 */
export class RPORtoMonitor {
  /** Latest event ts observed via `recordEventTime` or `attach()`. */
  private latestEventTs: number | null = null;
  /** Start ts of the current/last recovery operation. */
  private recoveryStartTs: number | null = null;
  /** End ts of the last recovery operation. */
  private recoveryEndTs: number | null = null;
  /** Target RPO (ms). */
  private targetRpo: number = DEFAULT_TARGET_RPO_MS;
  /** Target RTO (ms). */
  private targetRto: number = DEFAULT_TARGET_RTO_MS;
  /** Rolling measurement history. */
  private history: RPO_RTO_Measurement[] = [];
  /** Max history size. */
  private readonly maxHistory = 1_000;
  /** Detach function for the kernel bus subscription. */
  private detachFn: (() => void) | null = null;

  // --------------------------------------------------------------- targets

  /** Set the target RPO (ms). */
  setTargetRpo(ms: number): void {
    this.targetRpo = Math.max(0, ms);
  }

  /** Set the target RTO (ms). */
  setTargetRto(ms: number): void {
    this.targetRto = Math.max(0, ms);
  }

  /** Get the current target RPO (ms). */
  getTargetRpo(): number {
    return this.targetRpo;
  }

  /** Get the current target RTO (ms). */
  getTargetRto(): number {
    return this.targetRto;
  }

  // --------------------------------------------------------------- record

  /**
   * Record the latest event timestamp. Used to compute RPO as
   * `now - latestEventTs`. Callers typically wire this to the kernel
   * event bus via `attach()`, but it can also be called manually.
   */
  recordEventTime(ts: number): void {
    if (this.latestEventTs === null || ts > this.latestEventTs) {
      this.latestEventTs = ts;
    }
  }

  /**
   * Mark the start of a recovery operation. Used to compute RTO as
   * `recoveryEnd - recoveryStart`.
   */
  recordRecoveryStart(): void {
    this.recoveryStartTs = nowTs();
    this.recoveryEndTs = null;
  }

  /** Mark the end of a recovery operation. */
  recordRecoveryEnd(): void {
    this.recoveryEndTs = nowTs();
  }

  // --------------------------------------------------------------- measure

  /**
   * Produce an `RPO_RTO_Measurement`.
   *
   *  - `rpoMs = now - latestEventTs` (0 if no events have been recorded).
   *  - `rtoMs = recoveryEnd - recoveryStart` (0 if no recovery has been
   *    completed).
   *  - `compliant = rpoMs <= targetRpo && rtoMs <= targetRto`.
   *
   * The measurement is appended to the rolling history.
   */
  measure(): RPO_RTO_Measurement {
    const now = nowTs();
    const rpoMs = this.latestEventTs !== null
      ? Math.max(0, now - this.latestEventTs)
      : 0;
    const rtoMs = this.recoveryStartTs !== null && this.recoveryEndTs !== null
      ? Math.max(0, this.recoveryEndTs - this.recoveryStartTs)
      : 0;
    const compliant = rpoMs <= this.targetRpo && rtoMs <= this.targetRto;
    const measurement: RPO_RTO_Measurement = {
      rpoMs,
      rtoMs,
      measuredAt: now,
      targetRpo: this.targetRpo,
      targetRto: this.targetRto,
      compliant,
    };
    this.history.push(measurement);
    while (this.history.length > this.maxHistory) this.history.shift();

    eventEngine.emit('dr.rpo_rto_measured', {
      rpoMs,
      rtoMs,
      targetRpo: this.targetRpo,
      targetRto: this.targetRto,
      compliant,
      ts: now,
    });
    if (!compliant) {
      eventEngine.emit('dr.rpo_rto_violation', {
        rpoMs,
        rtoMs,
        targetRpo: this.targetRpo,
        targetRto: this.targetRto,
        ts: now,
      });
    }
    return measurement;
  }

  /**
   * Boolean compliance check — `true` iff the most recent measurement
   * (or a fresh measurement if none exists) is compliant.
   */
  isCompliant(): boolean {
    const latest = this.history[this.history.length - 1];
    if (latest) return latest.compliant;
    return this.measure().compliant;
  }

  /** Rolling measurement history (oldest first). */
  getHistory(): RPO_RTO_Measurement[] {
    return [...this.history];
  }

  /** The most recent measurement, or null. */
  getLatest(): RPO_RTO_Measurement | null {
    return this.history[this.history.length - 1] ?? null;
  }

  /** The latest event ts observed (or null). */
  getLatestEventTs(): number | null {
    return this.latestEventTs;
  }

  /** The current recovery start ts (or null). */
  getRecoveryStartTs(): number | null {
    return this.recoveryStartTs;
  }

  /** The most recent recovery end ts (or null). */
  getRecoveryEndTs(): number | null {
    return this.recoveryEndTs;
  }

  // --------------------------------------------------------------- attach

  /**
   * Auto-record the timestamp of every kernel event. Returns a `detach`
   * function. Idempotent.
   */
  attach(): () => void {
    if (this.detachFn) return this.detachFn;
    const off = eventEngine.on('', (evt) => {
      try {
        this.recordEventTime(evt.ts);
      } catch {
        // Never let a recording error propagate into the emitter.
      }
    });
    this.detachFn = off;
    return off;
  }

  /** Detach from the kernel event bus. */
  detach(): void {
    if (this.detachFn) {
      this.detachFn();
      this.detachFn = null;
    }
  }

  /** Reset all state (used in tests). */
  reset(): void {
    this.detach();
    this.latestEventTs = null;
    this.recoveryStartTs = null;
    this.recoveryEndTs = null;
    this.history.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_RPO_RTO: RPORtoMonitor | undefined;
}

/**
 * Singleton RPO/RTO monitor. Targets default to RPO < 60s, RTO < 5min.
 * Call `rpoRtoMonitor.attach()` to auto-record every kernel event's
 * timestamp.
 */
export const rpoRtoMonitor: RPORtoMonitor =
  globalThis.__PAYSWAP_DR_RPO_RTO ?? new RPORtoMonitor();

if (!globalThis.__PAYSWAP_DR_RPO_RTO) {
  globalThis.__PAYSWAP_DR_RPO_RTO = rpoRtoMonitor;
}
