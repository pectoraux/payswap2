/**
 * OPS-4: Observability — structured logs + RED metrics per tier.
 *
 * "Why was this payment slow?" should be answerable from a trace, not by
 * reading code.
 *
 * This module provides:
 *   1. Structured logging with paymentId correlation — every log line
 *      carries the paymentId, corridor, tier, and traceId.
 *   2. RED metrics (Rate, Errors, Duration) per waterfall tier — so
 *      operators can see "tier 3 is erroring at 5%" without reading code.
 *   3. SLO tracking — authorization latency, settlement success rate,
 *      with burn-rate alerting.
 *
 * Usage in handlers:
 *   const log = structuredLogger.payment(paymentId);
 *   log.info('routing.decision', { tier: 3, strategy: 'RESERVE_TO_MARKET' });
 *   const timer = redMetrics.startTier(3);
 *   ... do work ...
 *   timer.end({ success: true });
 */

import { eventEngine } from '@/kernel/event';
import { nowTs, uid } from '@/kernel/support';

// ── Structured logging with paymentId correlation ────────────────────────

export interface StructuredLogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  paymentId?: string;
  payoutId?: string;
  refundId?: string;
  corridor?: string;
  tier?: number;
  traceId?: string;
  message: string;
  data?: Record<string, unknown>;
}

class StructuredLogger {
  private logs: StructuredLogEntry[] = [];
  private maxLogs = 10_000;

  /** Create a payment-scoped logger. */
  payment(paymentId: string, opts: { corridor?: string; tier?: number; traceId?: string } = {}) {
    return {
      info: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'info', event, message, data, paymentId, ...opts }),
      warn: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'warn', event, message, data, paymentId, ...opts }),
      error: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'error', event, message, data, paymentId, ...opts }),
      debug: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'debug', event, message, data, paymentId, ...opts }),
    };
  }

  /** Create a payout-scoped logger. */
  payout(payoutId: string) {
    return {
      info: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'info', event, message, data, payoutId }),
      warn: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'warn', event, message, data, payoutId }),
      error: (event: string, message: string, data?: Record<string, unknown>) =>
        this.log({ level: 'error', event, message, data, payoutId }),
    };
  }

  /** Log a structured entry. */
  log(entry: Omit<StructuredLogEntry, 'ts'>) {
    const fullEntry: StructuredLogEntry = { ...entry, ts: nowTs() };
    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxLogs) this.logs.length = this.maxLogs;

    // Emit for external log aggregators (Datadog, CloudWatch, etc.).
    eventEngine.emit('log.structured', fullEntry as unknown as Record<string, unknown>);

    // Also console.log in development for debugging.
    const correlated = [
      fullEntry.paymentId ? `payment=${fullEntry.paymentId}` : '',
      fullEntry.tier ? `tier=${fullEntry.tier}` : '',
      fullEntry.corridor ? `corridor=${fullEntry.corridor}` : '',
    ].filter(Boolean).join(' ');
    const prefix = `[${fullEntry.level.toUpperCase()}] ${correlated ? correlated + ' ' : ''}`;
    if (fullEntry.level === 'error') {
      console.error(`${prefix}${fullEntry.event}: ${fullEntry.message}`);
    } else if (fullEntry.level === 'warn') {
      console.warn(`${prefix}${fullEntry.event}: ${fullEntry.message}`);
    } else {
      console.log(`${prefix}${fullEntry.event}: ${fullEntry.message}`);
    }
  }

  /** Query logs by paymentId (for "why was this payment slow?"). */
  forPayment(paymentId: string): StructuredLogEntry[] {
    return this.logs.filter(l => l.paymentId === paymentId);
  }

  /** Query logs by event type. */
  forEvent(event: string, limit: number = 50): StructuredLogEntry[] {
    return this.logs.filter(l => l.event === event).slice(0, limit);
  }

  /** Recent logs (for dashboard). */
  recent(limit: number = 100): StructuredLogEntry[] {
    return this.logs.slice(0, limit);
  }
}

// ── RED metrics per tier ─────────────────────────────────────────────────

export interface TierMetrics {
  tier: number;
  rate: number;           // requests per minute
  errorRate: number;      // 0-1 (0 = no errors, 1 = all errors)
  errorCount: number;
  successCount: number;
  totalCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  lastRequestTs: number;
}

class RedMetricsCollector {
  private tierData = new Map<number, {
    requests: { ts: number; durationMs: number; success: boolean }[];
    windowMs: number;
  }>();

  constructor(private windowMs: number = 5 * 60 * 1000) {} // 5-minute window

  /** Start a timer for a tier request. Returns an end() function. */
  startTier(tier: number): { end: (opts: { success: boolean }) => void } {
    const startTs = nowTs();
    return {
      end: (opts: { success: boolean }) => {
        const durationMs = nowTs() - startTs;
        this.record(tier, { ts: startTs, durationMs, success: opts.success });
      },
    };
  }

  /** Record a completed request. */
  private record(tier: number, request: { ts: number; durationMs: number; success: boolean }) {
    let data = this.tierData.get(tier);
    if (!data) {
      data = { requests: [], windowMs: this.windowMs };
      this.tierData.set(tier, data);
    }
    data.requests.push(request);
    // Prune old entries.
    const cutoff = nowTs() - this.windowMs;
    data.requests = data.requests.filter(r => r.ts > cutoff);
  }

  /** Get RED metrics for a tier. */
  getTierMetrics(tier: number): TierMetrics | null {
    const data = this.tierData.get(tier);
    if (!data || data.requests.length === 0) return null;

    const now = nowTs();
    const recent = data.requests.filter(r => now - r.ts < this.windowMs);
    if (recent.length === 0) return null;

    const successCount = recent.filter(r => r.success).length;
    const errorCount = recent.length - successCount;
    const durations = recent.map(r => r.durationMs).sort((a, b) => a - b);
    const avgDurationMs = durations.reduce((s, d) => s + d, 0) / durations.length;
    const windowMinutes = this.windowMs / 60_000;

    return {
      tier,
      rate: recent.length / windowMinutes,
      errorRate: errorCount / recent.length,
      errorCount,
      successCount,
      totalCount: recent.length,
      avgDurationMs: Math.round(avgDurationMs),
      p50DurationMs: durations[Math.floor(durations.length * 0.5)] ?? 0,
      p95DurationMs: durations[Math.floor(durations.length * 0.95)] ?? 0,
      p99DurationMs: durations[Math.floor(durations.length * 0.99)] ?? 0,
      lastRequestTs: recent[recent.length - 1]?.ts ?? 0,
    };
  }

  /** Get RED metrics for all tiers. */
  allTierMetrics(): TierMetrics[] {
    return [1, 2, 3, 4, 5]
      .map(tier => this.getTierMetrics(tier))
      .filter((m): m is TierMetrics => m !== null);
  }
}

// ── SLO tracking ─────────────────────────────────────────────────────────

export interface SLOStatus {
  name: string;
  target: string;
  current: string;
  burnRate: number;  // 1.0 = on track, >1 = burning budget fast
  status: 'healthy' | 'at_risk' | 'breached';
  ts: number;
}

class SLOTracker {
  private sloTargets = {
    authorization_latency_p95: { targetMs: 500, windowMs: 5 * 60 * 1000 },
    settlement_success_rate: { targetRate: 0.99, windowMs: 5 * 60 * 1000 },
    webhook_delivery_latency_p95: { targetMs: 1000, windowMs: 5 * 60 * 1000 },
  };

  private latencies: { ts: number; ms: number; type: string }[] = [];
  private settlements: { ts: number; success: boolean }[] = [];

  recordAuthorizationLatency(ms: number) {
    this.latencies.push({ ts: nowTs(), ms, type: 'authorization' });
    if (this.latencies.length > 10_000) this.latencies.shift();
  }

  recordSettlement(success: boolean) {
    this.settlements.push({ ts: nowTs(), success });
    if (this.settlements.length > 10_000) this.settlements.shift();
  }

  getStatus(): SLOStatus[] {
    const now = nowTs();
    const statuses: SLOStatus[] = [];

    // Authorization latency SLO
    const authLatencies = this.latencies
      .filter(l => l.type === 'authorization' && now - l.ts < this.sloTargets.authorization_latency_p95.windowMs)
      .map(l => l.ms)
      .sort((a, b) => a - b);
    if (authLatencies.length > 0) {
      const p95 = authLatencies[Math.floor(authLatencies.length * 0.95)] ?? 0;
      const target = this.sloTargets.authorization_latency_p95.targetMs;
      const burnRate = p95 / target;
      statuses.push({
        name: 'authorization_latency_p95',
        target: `< ${target}ms`,
        current: `${p95}ms`,
        burnRate,
        status: burnRate > 2 ? 'breached' : burnRate > 1 ? 'at_risk' : 'healthy',
        ts: now,
      });
    }

    // Settlement success rate SLO
    const recentSettlements = this.settlements.filter(s => now - s.ts < this.sloTargets.settlement_success_rate.windowMs);
    if (recentSettlements.length > 0) {
      const successRate = recentSettlements.filter(s => s.success).length / recentSettlements.length;
      const target = this.sloTargets.settlement_success_rate.targetRate;
      const burnRate = target / successRate; // inverted: higher = worse
      statuses.push({
        name: 'settlement_success_rate',
        target: `> ${(target * 100).toFixed(1)}%`,
        current: `${(successRate * 100).toFixed(1)}%`,
        burnRate,
        status: burnRate > 2 ? 'breached' : burnRate > 1 ? 'at_risk' : 'healthy',
        ts: now,
      });
    }

    return statuses;
  }
}

// ── Singletons (globalThis for Next.js dev-mode) ──────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_STRUCTURED_LOGGER: StructuredLogger | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_RED_METRICS: RedMetricsCollector | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_SLO_TRACKER: SLOTracker | undefined;
}

export const structuredLogger: StructuredLogger =
  globalThis.__PAYSWAP_STRUCTURED_LOGGER ?? new StructuredLogger();
if (!globalThis.__PAYSWAP_STRUCTURED_LOGGER) {
  globalThis.__PAYSWAP_STRUCTURED_LOGGER = structuredLogger;
}

export const redMetrics: RedMetricsCollector =
  globalThis.__PAYSWAP_RED_METRICS ?? new RedMetricsCollector();
if (!globalThis.__PAYSWAP_RED_METRICS) {
  globalThis.__PAYSWAP_RED_METRICS = redMetrics;
}

export const sloTracker: SLOTracker =
  globalThis.__PAYSWAP_SLO_TRACKER ?? new SLOTracker();
if (!globalThis.__PAYSWAP_SLO_TRACKER) {
  globalThis.__PAYSWAP_SLO_TRACKER = sloTracker;
}
