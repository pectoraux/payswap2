/**
 * PaySwap — Real Operational Metrics (P4-2 / H-7).
 *
 * Replaces the previous `/api/metrics` implementation that ran
 * `protocolScenarios()` (20 simulations) + `fuzz(100)` synchronously
 * on every request — a self-inflicted DOS surface that returned
 * synthetic numbers, not real telemetry.
 *
 * This module collects REAL signals:
 *   - process: memory, CPU, uptime, event-loop lag
 *   - db: `SELECT 1` round-trip latency + health
 *   - eventStore: count + lastSeq from the persisted event log
 *   - backups: count + latest backup metadata (P4-1 durability signal)
 *   - slo: every SLO's current value + on-track status (RED-aligned)
 *   - metricsRegistry: the live Prometheus-style counters/histograms
 *
 * ── APM wiring (production config change, NOT in scope for P4-2) ──
 *
 * To wire a real APM exporter:
 *
 *   OpenTelemetry:
 *     1. `npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http`
 *     2. In `src/instrumentation.ts` (already runs on server boot):
 *        ```ts
 *        import { NodeSDK } from '@opentelemetry/sdk-node';
 *        import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 *        const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }), serviceName: 'payswap-api' });
 *        sdk.start();
 *        ```
 *     3. Replace `tracer.startSpan(...)` in `src/protocol/ops/tracing.ts`
 *        with the real OTel tracer (the in-memory tracer there already
 *        follows the OTel API shape — drop-in).
 *     4. This `collectRealMetrics()` function then becomes a thin
 *        gauge-pull on top of the OTel metrics SDK — the JSON shape
 *        below is already compatible with OTel's `MetricReader`.
 *
 *   Datadog:
 *     1. `npm i dd-trace`
 *     2. In `instrumentation.ts`: `import tracer from 'dd-trace'; tracer.init({ service: 'payswap-api' });`
 *     3. The `payswap_*` metric names below are already dd-friendly
 *        (snake_case, `_total` / `_ms` / `_bytes` suffixes).
 *
 * Until then, this module is honest: it sets `apm.wired = false` so
 * consumers can see at a glance that APM is not yet exporting.
 *
 * No new npm packages are required to compile or run this module —
 * only Node's built-in `perf_hooks` + `process` APIs are used.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { db } from '@/lib/db';
import { eventStore } from '@/protocol/persistence';
import { metricsRegistry, METRIC_NAMES, sloManager } from '@/protocol/ops';
import { backupService } from '@/protocol/disaster-recovery';

/** Snapshot of all real operational signals, returned by `/api/metrics`. */
export interface RealMetricsSnapshot {
  /** Wall-clock ts when the snapshot was taken (epoch ms). */
  ts: number;
  /** Process-level metrics from Node's built-in APIs. */
  process: {
    pid: number;
    uptimeSeconds: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    /** Mean event-loop delay since the last snapshot (ms), or null if unavailable. */
    eventLoopLagMs: number | null;
    nodeVersion: string;
  };
  /** DB health — a real `SELECT 1` round-trip. */
  db: {
    healthy: boolean;
    /** `SELECT 1` latency in ms (null if the query failed). */
    latencyMs: number | null;
    error?: string;
  };
  /** Persisted event store stats. */
  eventStore: {
    eventCount: number;
    lastSeq: number;
    initialized: boolean;
    error?: string;
  };
  /** Backup durability (P4-1 signal). */
  backups: {
    count: number;
    latest: {
      id: string;
      type: string;
      createdAt: number;
      location: string;
      verifiedAt: number | null;
      verifyResult: string | null;
    } | null;
  };
  /**
   * SLO status (RED-aligned). Each SLO is one row; the underlying
   * counters/histograms back the rate / error / duration signals.
   */
  slo: Array<{
    id: string;
    name: string;
    direction: string;
    target: number;
    currentValue: number;
    onTrack: boolean;
    errorBudgetUsed: number;
    errorRate: number;
  }>;
  /** Live metrics registry JSON snapshot (counters + histograms). */
  metricsRegistry: Record<string, unknown>;
  /**
   * APM wiring status. `wired: false` means no APM SDK is installed —
   * see the module-level comment above for OTel / Datadog wiring steps.
   */
  apm: {
    wired: boolean;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Event-loop delay monitor (singleton, enabled once at module load).
// ---------------------------------------------------------------------------

const eventLoopMonitor = monitorEventLoopDelay();
eventLoopMonitor.enable();

// ---------------------------------------------------------------------------
// HTTP request counter (best-effort — see comment in collectRealMetrics).
// ---------------------------------------------------------------------------

const HTTP_REQUESTS_METRIC = 'payswap_http_requests_total';

/**
 * Best-effort HTTP request counter. Incremented by `/api/metrics` on
 * every call (so at minimum the counter reflects "how many times has
 * monitoring scraped us?"). To make this a REAL total-requests counter,
 * add a Next.js middleware that calls `incrementHttpRequest(route)` on
 * every `/api/*` request — see `src/middleware.ts`.
 */
export function incrementHttpRequest(route: string, status = '2xx'): void {
  try {
    const counter = metricsRegistry.registerCounter(
      HTTP_REQUESTS_METRIC,
      'Total HTTP requests (best-effort — incremented by /api/metrics only; wire middleware for full coverage).',
      ['route', 'status'],
    );
    counter.inc({ route, status });
  } catch {
    // ignore — never let a metrics call crash a request
  }
}

// ---------------------------------------------------------------------------
// collectRealMetrics
// ---------------------------------------------------------------------------

/** DB query timeout — keep `/api/metrics` snappy even if the DB is slow. */
const DB_HEALTH_TIMEOUT_MS = 2_000;

/**
 * Run a real `SELECT 1` against the DB with a hard timeout. Returns
 * `{ healthy, latencyMs, error }`. Never throws — a slow / failed DB
 * is itself a real metric the endpoint should report.
 */
async function probeDbHealth(): Promise<{
  healthy: boolean;
  latencyMs: number | null;
  error?: string;
}> {
  const start = Date.now();
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`timeout after ${DB_HEALTH_TIMEOUT_MS}ms`)),
          DB_HEALTH_TIMEOUT_MS,
        ),
      ),
    ]);
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Collect a full real-metrics snapshot. Safe to call from a request
 * handler — never throws (each section is independently try/caught).
 */
export async function collectRealMetrics(): Promise<RealMetricsSnapshot> {
  // --- Process metrics (sync, free) ---
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const uptimeSeconds = process.uptime();
  // Event-loop lag: read mean over the last interval, then reset.
  const elLagNs = eventLoopMonitor.mean;
  const eventLoopLagMs = Number.isFinite(elLagNs) && elLagNs > 0
    ? Math.round((elLagNs / 1e6) * 100) / 100
    : null;
  eventLoopMonitor.reset();

  // --- DB health (async, bounded) ---
  const dbHealth = await probeDbHealth();

  // --- Event store stats (async, may throw if DB down) ---
  let eventStoreStats: RealMetricsSnapshot['eventStore'] = {
    eventCount: 0,
    lastSeq: 0,
    initialized: false,
  };
  try {
    const count = await eventStore.count();
    eventStoreStats = {
      eventCount: count,
      lastSeq: eventStore.currentSeq(),
      initialized: true,
    };
  } catch (err) {
    eventStoreStats = {
      eventCount: 0,
      lastSeq: 0,
      initialized: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // --- Backup stats (sync, in-memory cache read from disk on startup) ---
  let backupStats: RealMetricsSnapshot['backups'] = { count: 0, latest: null };
  try {
    const latest = backupService.getLatestBackup();
    backupStats = {
      count: backupService.count(),
      latest: latest
        ? {
            id: latest.id,
            type: latest.type,
            createdAt: latest.createdAt,
            location: latest.location,
            verifiedAt: latest.verifiedAt ?? null,
            verifyResult: latest.verifyResult ?? null,
          }
        : null,
    };
  } catch {
    // keep defaults
  }

  // --- SLO status (sync — reads the metrics registry) ---
  let sloStatus: RealMetricsSnapshot['slo'] = [];
  try {
    const statuses = sloManager.evaluate(metricsRegistry);
    sloStatus = statuses.map((s) => ({
      id: s.slo.id,
      name: s.slo.name,
      direction: s.slo.direction ?? 'at_least',
      target: s.target,
      currentValue: s.currentValue,
      onTrack: s.onTrack,
      errorBudgetUsed: s.errorBudgetUsed,
      errorRate: s.errorRate,
    }));
  } catch {
    // keep empty
  }

  // --- Best-effort request counter (incremented on every /api/metrics call) ---
  // See `incrementHttpRequest` doc above for how to make this a real
  // total-requests counter.
  incrementHttpRequest('/api/metrics', '2xx');

  // --- Metrics registry JSON snapshot ---
  let registryJson: Record<string, unknown> = {};
  try {
    registryJson = metricsRegistry.json();
  } catch {
    // keep empty
  }

  return {
    ts: Date.now(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(uptimeSeconds),
      memoryUsage,
      cpuUsage,
      eventLoopLagMs,
      nodeVersion: process.version,
    },
    db: dbHealth,
    eventStore: eventStoreStats,
    backups: backupStats,
    slo: sloStatus,
    metricsRegistry: registryJson,
    apm: {
      wired: false,
      note: 'APM SDK not installed — see src/lib/real-metrics.ts module comment for OpenTelemetry / Datadog wiring steps.',
    },
  };
}

// ---------------------------------------------------------------------------
// Prometheus text format
// ---------------------------------------------------------------------------

/** Append a `# HELP` + `# TYPE` + value triple to a lines array. */
function pushGauge(
  lines: string[],
  name: string,
  help: string,
  value: number,
  labels?: Record<string, string>,
): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} gauge`);
  const labelStr = labels && Object.keys(labels).length > 0
    ? '{' + Object.keys(labels).sort().map((k) => `${k}="${labels[k]}"`).join(',') + '}'
    : '';
  lines.push(`${name}${labelStr} ${value}`);
}

/**
 * Render a `RealMetricsSnapshot` to Prometheus text exposition format.
 *
 * The output is the union of:
 *   - Process / DB / event-store / backup gauges (defined here),
 *   - The metrics registry's own exposition (counters/histograms/gauges
 *     registered by the rest of the system — see `metricsRegistry.expose()`).
 *
 * Both halves use standard Prometheus metric naming: `payswap_*` prefix,
 * `_total` for counters, `_ms` / `_bytes` / `_seconds` for units.
 */
export function toPrometheusText(snapshot: RealMetricsSnapshot): string {
  const lines: string[] = [];

  // --- Process ---
  pushGauge(lines, 'payswap_process_uptime_seconds', 'Process uptime in seconds.', snapshot.process.uptimeSeconds);
  pushGauge(lines, 'payswap_process_memory_rss_bytes', 'Resident Set Size in bytes.', snapshot.process.memoryUsage.rss);
  pushGauge(lines, 'payswap_process_memory_heap_used_bytes', 'Heap used in bytes.', snapshot.process.memoryUsage.heapUsed);
  pushGauge(lines, 'payswap_process_memory_heap_total_bytes', 'Heap total in bytes.', snapshot.process.memoryUsage.heapTotal);
  pushGauge(lines, 'payswap_process_memory_external_bytes', 'External (C++) memory in bytes.', snapshot.process.memoryUsage.external);
  pushGauge(lines, 'payswap_process_memory_array_buffers_bytes', 'ArrayBuffer memory in bytes.', snapshot.process.memoryUsage.arrayBuffers);
  if (snapshot.process.eventLoopLagMs !== null) {
    pushGauge(lines, 'payswap_process_event_loop_lag_ms', 'Mean event-loop delay since the last scrape (ms).', snapshot.process.eventLoopLagMs);
  }

  // --- DB health ---
  pushGauge(lines, 'payswap_db_healthy', '1 if SELECT 1 succeeded within the timeout, 0 otherwise.', snapshot.db.healthy ? 1 : 0);
  if (snapshot.db.latencyMs !== null) {
    pushGauge(lines, 'payswap_db_latency_ms', 'SELECT 1 round-trip latency in milliseconds.', snapshot.db.latencyMs);
  }

  // --- Event store ---
  pushGauge(lines, 'payswap_event_store_count', 'Total events persisted to the event store.', snapshot.eventStore.eventCount);
  pushGauge(lines, 'payswap_event_store_last_seq', 'Last seq number assigned by the event store.', snapshot.eventStore.lastSeq);
  pushGauge(lines, 'payswap_event_store_initialized', '1 if the event store has been initialised from the DB, 0 otherwise.', snapshot.eventStore.initialized ? 1 : 0);

  // --- Backups (P4-1 durability signal) ---
  pushGauge(lines, 'payswap_backups_count', 'Total backups currently in the durable store.', snapshot.backups.count);
  if (snapshot.backups.latest) {
    pushGauge(lines, 'payswap_backup_latest_created_at_ms', 'Creation ts of the most recent backup (epoch ms).', snapshot.backups.latest.createdAt, { id: snapshot.backups.latest.id, type: snapshot.backups.latest.type });
    pushGauge(lines, 'payswap_backup_latest_verified', '1 if the most recent backup was verified, 0 otherwise.', snapshot.backups.latest.verifiedAt ? 1 : 0);
  }

  // --- SLO status (RED-aligned) ---
  for (const slo of snapshot.slo) {
    const labels = { slo: slo.id };
    pushGauge(lines, 'payswap_slo_current_value', 'Current measured value of the SLO.', slo.currentValue, labels);
    pushGauge(lines, 'payswap_slo_target', 'Target value of the SLO.', slo.target, labels);
    pushGauge(lines, 'payswap_slo_on_track', '1 if the SLO is currently satisfied, 0 otherwise.', slo.onTrack ? 1 : 0, labels);
    pushGauge(lines, 'payswap_slo_error_budget_used', 'Fraction of the error budget consumed (1.0 = at the limit, >1 = breached).', slo.errorBudgetUsed, labels);
    pushGauge(lines, 'payswap_slo_error_rate', 'Observed error rate for the SLO.', slo.errorRate, labels);
  }

  // --- Metrics registry (all registered counters / histograms / gauges) ---
  // `metricsRegistry.expose()` returns the canonical Prometheus text
  // exposition for every registered metric. We append it verbatim —
  // it includes its own `# HELP` / `# TYPE` lines per metric.
  lines.push(metricsRegistry.expose());

  return lines.join('\n') + '\n';
}
