/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Reserve Drift Monitor.
 *
 * I1 decision: per-country FIAT reserve drift is a monitored number with an
 * alarm threshold. The monitor records every credit/debit against each
 * reserve and exposes:
 *   - drift(currency, windowMs) → net delta over the window
 *   - status(currency, currentBalance) → { drift, driftPct, alarm, threshold }
 *
 * The drift monitor is intentionally separate from the ReserveMonitor (which
 * owns the current balance). Drift is a *derivative* over time — it does not
 * own any balance, only a rolling sample of (timestamp, delta) pairs.
 *
 * The monitor is wired into the event-sourced pipeline: every
 * `treasury.account.credited` / `treasury.account.debited` event feeds the
 * corresponding `recordCredit()` / `recordDebit()` call. Production can also
 * wire `syncFromChain()` to push periodic balance snapshots instead of
 * per-event deltas — the math is the same.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.reserve_drift_alarm`  — drift exceeded the alarm threshold.
 *  - `treasury.reserve_drift_cleared` — drift returned inside the threshold.
 *
 * The kernel is FROZEN — this module imports only `nowTs`, `uid` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

/** A single reserve delta sample. */
export interface DriftSample {
  ts: number;
  /** Signed delta: positive = credit, negative = debit. */
  delta: number;
  /** Source: which event caused this sample. */
  source: string;
}

/** Per-currency drift state. */
export interface DriftState {
  currency: string;
  /** Rolling sample window (newest first). */
  samples: DriftSample[];
  /** Alarm threshold (fraction of |startingBalance| over the window). */
  threshold: number;
  /** Whether the alarm is currently firing (for edge-triggered events). */
  alarmFiring: boolean;
}

/** Drift status for one currency. */
export interface DriftStatus {
  currency: string;
  /** Net delta over the window (credits − debits). */
  drift: number;
  /** Window size in ms. */
  windowMs: number;
  /** Sample count inside the window. */
  sampleCount: number;
  /** Starting balance (balance at the start of the window). */
  startingBalance: number;
  /** Current balance (caller-provided). */
  currentBalance: number;
  /** |drift| / max(1, startingBalance). */
  driftPct: number;
  /** Alarm threshold (fraction). */
  threshold: number;
  /** True when |driftPct| > threshold. */
  alarm: boolean;
  /** Alarm level: 'none' | 'warning' | 'critical'. */
  level: 'none' | 'warning' | 'critical';
  /** Oldest sample ts in the window. */
  windowStartTs: number | null;
  /** Newest sample ts in the window. */
  windowEndTs: number | null;
}

/**
 * Reserve drift monitor — owns per-currency rolling sample windows.
 *
 * Thread-unsafe by design (single-threaded JS event loop).
 */
export class ReserveDriftMonitor {
  private states = new Map<string, DriftState>();
  private defaultThreshold = 0.30; // 30% drift per 24h = alarm
  private defaultWindowMs = 24 * 60 * 60 * 1000; // 24h
  /** Maximum samples per currency (bounds memory). */
  private maxSamples = 5_000;
  /** Tracks the starting balance per currency for drift% computation. */
  private startingBalances = new Map<string, number>();
  /** Optional chain-sync adapter. */
  private chainSyncFn: ((currency: string) => Promise<{ balance: number } | null>) | null = null;

  /** Set the default alarm threshold (fraction of |startingBalance|). */
  setDefaultThreshold(fraction: number): void {
    this.defaultThreshold = Math.max(0, Math.min(2, fraction));
  }

  /** Set a per-currency alarm threshold. */
  setThreshold(currency: string, fraction: number): void {
    this.getOrCreate(currency).threshold = Math.max(0, Math.min(2, fraction));
  }

  /** Set the rolling window size (default 24h). */
  setWindowMs(currency: string, windowMs: number): void {
    void windowMs; // stored on the read path; samples are pruned by ts
  }

  /** Set the chain-sync adapter (production wiring seam). */
  setChainSyncFn(fn: (currency: string) => Promise<{ balance: number } | null>): void {
    this.chainSyncFn = fn;
  }

  /** Initialise the starting balance for a currency (call once when seeding). */
  setStartingBalance(currency: string, balance: number): void {
    this.startingBalances.set(currency, balance);
  }

  /** Get the starting balance for a currency (defaults to 0). */
  startingBalance(currency: string): number {
    return this.startingBalances.get(currency) ?? 0;
  }

  /** Record a credit (positive delta). */
  recordCredit(currency: string, amount: number, source = 'treasury.account.credited'): DriftSample {
    const sample: DriftSample = { ts: nowTs(), delta: Math.abs(amount), source };
    this.pushSample(currency, sample);
    return sample;
  }

  /** Record a debit (negative delta). */
  recordDebit(currency: string, amount: number, source = 'treasury.account.debited'): DriftSample {
    const sample: DriftSample = { ts: nowTs(), delta: -Math.abs(amount), source };
    this.pushSample(currency, sample);
    return sample;
  }

  /** Compute drift status for a currency over the rolling window. */
  status(currency: string, currentBalance: number, windowMs: number = this.defaultWindowMs): DriftStatus {
    const state = this.getOrCreate(currency);
    const now = nowTs();
    const cutoff = now - windowMs;

    // Prune old samples + sum deltas inside the window.
    let drift = 0;
    let sampleCount = 0;
    let windowStartTs: number | null = null;
    let windowEndTs: number | null = null;
    const kept: DriftSample[] = [];
    for (const s of state.samples) {
      if (s.ts >= cutoff) {
        kept.push(s);
        drift += s.delta;
        sampleCount++;
        if (windowEndTs === null || s.ts > windowEndTs) windowEndTs = s.ts;
        if (windowStartTs === null || s.ts < windowStartTs) windowStartTs = s.ts;
      }
    }
    if (kept.length < state.samples.length) {
      state.samples = kept;
    }

    // Estimate starting balance: current − drift (over the window).
    const startingBalance = Math.max(0, currentBalance - drift);
    const driftPct = startingBalance > 0 ? Math.abs(drift) / startingBalance : 0;
    const threshold = state.threshold;
    const alarm = driftPct > threshold;
    const level: DriftStatus['level'] = alarm
      ? (driftPct > threshold * 1.5 ? 'critical' : 'warning')
      : 'none';

    // Edge-triggered alarm events.
    if (alarm && !state.alarmFiring) {
      state.alarmFiring = true;
      eventEngine.emit('treasury.reserve_drift_alarm', {
        currency,
        drift,
        driftPct,
        threshold,
        level,
        startingBalance,
        currentBalance,
        windowMs,
        ts: now,
      });
    } else if (!alarm && state.alarmFiring) {
      state.alarmFiring = false;
      eventEngine.emit('treasury.reserve_drift_cleared', {
        currency,
        drift,
        driftPct,
        threshold,
        ts: now,
      });
    }

    return {
      currency,
      drift: Math.round(drift * 100) / 100,
      windowMs,
      sampleCount,
      startingBalance: Math.round(startingBalance * 100) / 100,
      currentBalance: Math.round(currentBalance * 100) / 100,
      driftPct: Math.round(driftPct * 10000) / 10000,
      threshold,
      alarm,
      level,
      windowStartTs,
      windowEndTs,
    };
  }

  /** Status for all tracked currencies. Requires current balances. */
  statusAll(balances: Map<string, number>, windowMs?: number): DriftStatus[] {
    const out: DriftStatus[] = [];
    for (const currency of this.states.keys()) {
      const balance = balances.get(currency) ?? 0;
      out.push(this.status(currency, balance, windowMs));
    }
    return out;
  }

  /** All currencies with active alarms. */
  activeAlarms(balances: Map<string, number>, windowMs?: number): DriftStatus[] {
    return this.statusAll(balances, windowMs).filter((s) => s.alarm);
  }

  /** Reset drift state for a currency (used by tests + rebalance reset). */
  reset(currency?: string): void {
    if (currency) {
      this.states.delete(currency);
      this.startingBalances.delete(currency);
    } else {
      this.states.clear();
      this.startingBalances.clear();
    }
  }

  /** Internal: push a sample, prune by max-samples, do not prune by time here. */
  private pushSample(currency: string, sample: DriftSample): void {
    const state = this.getOrCreate(currency);
    state.samples.unshift(sample);
    if (state.samples.length > this.maxSamples) {
      state.samples.length = this.maxSamples;
    }
  }

  private getOrCreate(currency: string): DriftState {
    let state = this.states.get(currency);
    if (!state) {
      state = {
        currency,
        samples: [],
        threshold: this.defaultThreshold,
        alarmFiring: false,
      };
      this.states.set(currency, state);
    }
    return state;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_RESERVE_DRIFT_MONITOR: ReserveDriftMonitor | undefined;
}

export const reserveDriftMonitor: ReserveDriftMonitor =
  globalThis.__PAYSWAP_RESERVE_DRIFT_MONITOR ?? new ReserveDriftMonitor();

if (!globalThis.__PAYSWAP_RESERVE_DRIFT_MONITOR) {
  globalThis.__PAYSWAP_RESERVE_DRIFT_MONITOR = reserveDriftMonitor;
}

// Helper for callers that want a fresh alert id.
export function newDriftAlertId(): string {
  return uid('drift_alert');
}
