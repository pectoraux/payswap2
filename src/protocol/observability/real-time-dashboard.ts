/**
 * PaySwap Protocol — Observability — Real-Time Dashboard Aggregator.
 *
 * A live, in-memory snapshot of everything happening in PaySwap:
 *   - `getOverview()`         : live KPI snapshot
 *   - `getPaymentFeed(limit)` : recent payments
 *   - `getSettlementFeed()`   : recent settlements
 *   - `getAlertFeed()`        : recent alerts (KPI warnings/critical + treasury)
 *   - `getSystemMetrics()`    : CPU/memory/event throughput
 *   - `subscribe(eventType, cb)` : WebSocket-ready pub/sub for real-time UIs
 *
 * Designed for the WebSocket layer: callers `subscribe('payment', cb)` and
 * receive a callback every time a payment is recorded; they `subscribe('kpi', cb)`
 * to get KPI updates; etc. The dashboard keeps an internal ring buffer of the
 * last N events of each kind so the feed endpoints can serve historical
 * context to freshly-connected clients.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`, plus the
 * sibling observability singletons.
 */
import { nowTs, round } from '@/kernel/support';
import { eventEngine, type EventEngine } from '@/kernel/event';
import { kpiTracker, type BusinessKPI } from './business-kpis';
import {
  paymentAnalytics,
  type PaymentRecord,
  type PayoutRecord,
} from './payment-analytics';
import {
  settlementAnalytics,
  type SettlementRecord,
} from './settlement-analytics';
import { connectorAnalytics } from './connector-analytics';
import { inMemorySpanExporter } from './tracing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardEventType =
  | 'payment'
  | 'payout'
  | 'settlement'
  | 'alert'
  | 'kpi'
  | 'system';

export interface DashboardAlert {
  id: string;
  ts: number;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface SystemMetrics {
  ts: number;
  uptimeMs: number;
  memoryMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  eventThroughputPerSec: number;
  spansPerSec: number;
  paymentEventsPerSec: number;
  nodeVersion: string;
}

export interface DashboardOverview {
  ts: number;
  kpis: BusinessKPI[];
  alertCount: number;
  activeMerchants: number;
  activeLPs: number;
  paymentVolume24h: number;
  payoutVolume24h: number;
  settlementSuccessRate: number;
  connectorUptimeAvg: number;
  reserveBackingRatio: number;
}

export type DashboardEventPayload =
  | { type: 'payment'; payment: PaymentRecord }
  | { type: 'payout'; payout: PayoutRecord }
  | { type: 'settlement'; settlement: SettlementRecord }
  | { type: 'alert'; alert: DashboardAlert }
  | { type: 'kpi'; kpi: BusinessKPI }
  | { type: 'system'; metrics: SystemMetrics };

export type DashboardSubscriber = (payload: DashboardEventPayload) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const FEED_LIMIT = 500;

export class RealTimeDashboard {
  private paymentFeed: PaymentRecord[] = [];
  private payoutFeed: PayoutRecord[] = [];
  private settlementFeed: SettlementRecord[] = [];
  private alertFeed: DashboardAlert[] = [];
  private subscribers = new Map<DashboardEventType, Set<DashboardSubscriber>>();
  private startedAt: number;
  private lastEventCount = 0;
  private lastEventSampleTs = nowTs();
  private lastSpanCount = 0;
  private lastSpanSampleTs = nowTs();
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.startedAt = nowTs();
  }

  // ------------------------------------------------------------------ feeds

  /** Push a payment into the live feed. */
  pushPayment(payment: PaymentRecord): void {
    this.paymentFeed.push(payment);
    if (this.paymentFeed.length > FEED_LIMIT) {
      this.paymentFeed = this.paymentFeed.slice(-FEED_LIMIT);
    }
    this.emit('payment', { type: 'payment', payment });
  }

  /** Push a payout into the live feed. */
  pushPayout(payout: PayoutRecord): void {
    this.payoutFeed.push(payout);
    if (this.payoutFeed.length > FEED_LIMIT) {
      this.payoutFeed = this.payoutFeed.slice(-FEED_LIMIT);
    }
    this.emit('payout', { type: 'payout', payout });
  }

  /** Push a settlement into the live feed. */
  pushSettlement(settlement: SettlementRecord): void {
    this.settlementFeed.push(settlement);
    if (this.settlementFeed.length > FEED_LIMIT) {
      this.settlementFeed = this.settlementFeed.slice(-FEED_LIMIT);
    }
    this.emit('settlement', { type: 'settlement', settlement });
  }

  /** Push an alert into the live feed. */
  pushAlert(alert: DashboardAlert): void {
    this.alertFeed.push(alert);
    if (this.alertFeed.length > FEED_LIMIT) {
      this.alertFeed = this.alertFeed.slice(-FEED_LIMIT);
    }
    this.emit('alert', { type: 'alert', alert });
  }

  /** Push a KPI update. */
  pushKPI(kpi: BusinessKPI): void {
    this.emit('kpi', { type: 'kpi', kpi });
  }

  /** Push a system-metrics update. */
  pushSystemMetrics(metrics: SystemMetrics): void {
    this.emit('system', { type: 'system', metrics });
  }

  // ------------------------------------------------------------------ read API

  /** Live KPI snapshot + 24h rollups. */
  getOverview(): DashboardOverview {
    const now = nowTs();
    const range24h = { from: now - DAY_MS, to: now };
    const kpis = kpiTracker.getAllKPIs();
    const alertCount = this.alertFeed.filter(
      (a) => a.severity === 'warning' || a.severity === 'critical',
    ).length;
    const paymentVolume24h = paymentAnalytics.getPaymentVolume(range24h);
    const payoutVolume24h = paymentAnalytics.getPayoutVolume(range24h);
    const settlementSuccessRate = paymentAnalytics.getSuccessRate(range24h);
    const connectorComparison = connectorAnalytics.getConnectorComparison(range24h);
    const reserveBackingKPI = kpiTracker.getKPI('reserve_backing_ratio');
    return {
      ts: now,
      kpis,
      alertCount,
      activeMerchants: kpiTracker.getKPI('active_merchants')?.value ?? 0,
      activeLPs: kpiTracker.getKPI('active_lps')?.value ?? 0,
      paymentVolume24h,
      payoutVolume24h,
      settlementSuccessRate,
      connectorUptimeAvg: connectorComparison.totals.avgUptime,
      reserveBackingRatio: reserveBackingKPI?.value ?? 0,
    };
  }

  /** Recent payments (newest last). */
  getPaymentFeed(limit = 50): PaymentRecord[] {
    return this.paymentFeed.slice(-limit);
  }

  /** Recent payouts (newest last). */
  getPayoutFeed(limit = 50): PayoutRecord[] {
    return this.payoutFeed.slice(-limit);
  }

  /** Recent settlements (newest last). */
  getSettlementFeed(limit = 50): SettlementRecord[] {
    return this.settlementFeed.slice(-limit);
  }

  /** Recent alerts (newest last). */
  getAlertFeed(limit = 50): DashboardAlert[] {
    return this.alertFeed.slice(-limit);
  }

  /**
   * System metrics — CPU/memory/event throughput. Uses `process.resourceUsage`
   * when available (Node.js), degrades gracefully otherwise.
   */
  getSystemMetrics(): SystemMetrics {
    const now = nowTs();
    let memoryMb = 0;
    let cpuUserMs = 0;
    let cpuSystemMs = 0;
    try {
      const mem = (process as NodeJS.Process & { memoryUsage?: () => NodeJS.MemoryUsage })
        .memoryUsage?.();
      if (mem) memoryMb = round(mem.rss / (1024 * 1024), 2);
    } catch {
      // ignore
    }
    try {
      const usage = (process as NodeJS.Process & {
        resourceUsage?: () => { userCPUTime: number; systemCPUTime: number };
      }).resourceUsage?.();
      if (usage) {
        cpuUserMs = Math.round(usage.userCPUTime / 1000);
        cpuSystemMs = Math.round(usage.systemCPUTime / 1000);
      }
    } catch {
      // ignore
    }
    // Event throughput
    let eventCount = 0;
    try {
      eventCount = eventEngine.read().length;
    } catch {
      // ignore
    }
    const elapsedSec = Math.max(0.001, (now - this.lastEventSampleTs) / 1000);
    const eventDelta = Math.max(0, eventCount - this.lastEventCount);
    const eventThroughputPerSec = round(eventDelta / elapsedSec, 4);
    this.lastEventCount = eventCount;
    this.lastEventSampleTs = now;

    // Span throughput
    const spanCount = inMemorySpanExporter?.count?.() ?? 0;
    const spanElapsedSec = Math.max(0.001, (now - this.lastSpanSampleTs) / 1000);
    const spanDelta = Math.max(0, spanCount - this.lastSpanCount);
    const spansPerSec = round(spanDelta / spanElapsedSec, 4);
    this.lastSpanCount = spanCount;
    this.lastSpanSampleTs = now;

    // Payment events per sec (rough estimate from the feed)
    const paymentEventsPerSec = round(this.paymentFeed.length / Math.max(1, (now - this.startedAt) / 1000), 4);

    return {
      ts: now,
      uptimeMs: now - this.startedAt,
      memoryMb,
      cpuUserMs,
      cpuSystemMs,
      eventThroughputPerSec,
      spansPerSec,
      paymentEventsPerSec,
      nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown',
    };
  }

  // ------------------------------------------------------------------ pub/sub

  /**
   * Subscribe to a dashboard event type. Returns an unsubscribe function.
   * WebSocket adapters call this once per connected client.
   */
  subscribe(eventType: DashboardEventType, callback: DashboardSubscriber): () => void {
    let set = this.subscribers.get(eventType);
    if (!set) {
      set = new Set();
      this.subscribers.set(eventType, set);
    }
    set.add(callback);
    return () => {
      set?.delete(callback);
    };
  }

  /** Emit a dashboard event to every subscriber of its type. */
  private emit(eventType: DashboardEventType, payload: DashboardEventPayload): void {
    const set = this.subscribers.get(eventType);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        // subscribers must never break the dashboard
      }
    }
  }

  /**
   * Wire the dashboard to the kernel event bus + sibling analytics services.
   * Auto-pushes:
   *   - payouts (from payout.* events)
   *   - settlements (from treasury.lp_settlement_recorded)
   *   - alerts (from treasury.*_blocked, treasury.backing_mismatch, treasury.shortfall_alert)
   *
   * Returns a stop function. Call it once on shutdown.
   */
  attach(eventBus: EventEngine = eventEngine): () => void {
    const payoutOff = eventBus.on('payout.', (event) => {
      try {
        if (!event.type.startsWith('payout.')) return;
        const p = event.payload as {
          payoutId?: string;
          merchantId?: string;
          amount?: number;
          currency?: string;
          method?: string;
          fee?: number;
        };
        const status: PayoutRecord['status'] =
          event.type === 'payout.completed'
            ? 'completed'
            : event.type === 'payout.failed'
              ? 'failed'
              : event.type === 'payout.cancelled'
                ? 'cancelled'
                : event.type === 'payout.processing'
                  ? 'processing'
                  : 'pending';
        this.pushPayout({
          id: p.payoutId ?? '',
          merchantId: p.merchantId,
          amount: p.amount ?? 0,
          currency: p.currency ?? '',
          method: p.method,
          status,
          fee: p.fee,
          createdAt: event.ts,
          completedAt: event.type === 'payout.completed' ? event.ts : undefined,
        });
      } catch {
        // non-invasive
      }
    });

    const settlementOff = eventBus.on('treasury.lp_settlement_recorded', (event) => {
      try {
        const p = event.payload as {
          lpId?: string;
          corridor?: string;
          volume?: number;
          fee?: number;
        };
        this.pushSettlement({
          id: `s_${event.ts}_${p.lpId ?? 'x'}`,
          lpId: p.lpId,
          corridor: p.corridor,
          amount: p.volume ?? 0,
          currency: '',
          status: 'succeeded',
          startedAt: event.ts,
          settledAt: event.ts,
          durationMs: 0,
        });
      } catch {
        // non-invasive
      }
    });

    const alertOff = eventBus.on('treasury.', (event) => {
      try {
        const alertTypes: Record<string, { severity: 'info' | 'warning' | 'critical'; message: string }> = {
          'treasury.pre_mint_blocked': { severity: 'critical', message: 'Mint blocked by pre-mint hook' },
          'treasury.pre_burn_blocked': { severity: 'critical', message: 'Burn blocked by pre-burn hook' },
          'treasury.backing_mismatch': { severity: 'critical', message: 'Backing mismatch detected' },
          'treasury.backing_blocked': { severity: 'critical', message: 'Backing block enforced' },
          'treasury.shortfall_alert': { severity: 'warning', message: 'Liquidity shortfall forecast' },
          'treasury.reserve_low': { severity: 'warning', message: 'Reserve below threshold' },
          'treasury.lp_underperforming': { severity: 'warning', message: 'LP underperforming' },
        };
        const def = alertTypes[event.type];
        if (!def) return;
        this.pushAlert({
          id: `a_${event.ts}_${event.type}`,
          ts: event.ts,
          severity: def.severity,
          source: event.type,
          message: def.message,
          context: event.payload as Record<string, unknown>,
        });
      } catch {
        // non-invasive
      }
    });

    // Push periodic KPI + system-metrics updates so subscribers stay fresh.
    const kpiTimer = setInterval(() => {
      try {
        for (const kpi of kpiTracker.getAllKPIs()) {
          if (kpi.status === 'warning' || kpi.status === 'critical') {
            this.pushKPI(kpi);
          }
        }
      } catch {
        // ignore
      }
    }, 30_000);
    kpiTimer.unref?.();

    const systemTimer = setInterval(() => {
      try {
        this.pushSystemMetrics(this.getSystemMetrics());
      } catch {
        // ignore
      }
    }, 15_000);
    systemTimer.unref?.();

    const stop = () => {
      payoutOff();
      settlementOff();
      alertOff();
      clearInterval(kpiTimer);
      clearInterval(systemTimer);
    };
    this.unsubscribers.push(stop);
    return stop;
  }

  /** Stop every active attachment. */
  shutdown(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.subscribers.clear();
  }

  /** Reset all feeds (testing only). */
  reset(): void {
    this.paymentFeed = [];
    this.payoutFeed = [];
    this.settlementFeed = [];
    this.alertFeed = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForDashboard = globalThis as unknown as {
  __PAYSWAP_REALTIME_DASHBOARD?: RealTimeDashboard;
};

export const realTimeDashboard: RealTimeDashboard =
  _globalForDashboard.__PAYSWAP_REALTIME_DASHBOARD ?? new RealTimeDashboard();
if (!_globalForDashboard.__PAYSWAP_REALTIME_DASHBOARD) {
  _globalForDashboard.__PAYSWAP_REALTIME_DASHBOARD = realTimeDashboard;
}

export type { EventEngine };
