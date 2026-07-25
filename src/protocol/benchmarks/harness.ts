/**
 * PaySwap Protocol — Performance Benchmarks / Harness.
 * -----------------------------------------------------------------------------
 * A lightweight benchmark harness that schedules operations at a target TPS,
 * records per-op latency, and reports p50/p95/p99/max + memory + CPU deltas.
 *
 * Design:
 *  - For each op `i`, the desired start time is `wallStart + i * (1000/targetTps)`.
 *  - The harness waits (spin-wait for high TPS, setTimeout for low TPS) until
 *    the desired start time, then fires `fn()`.
 *  - If `fn` is synchronous (returns non-Promise), latency is recorded
 *    immediately. If async, the op is tracked in an `inflight` set and resolved
 *    later (capped at `maxConcurrency` to bound memory).
 *  - If `fn` is slower than the target interval, subsequent ops start
 *    immediately after the previous one ends (no wait) — `actualTps` will be
 *    below `targetTps`, which is exactly the "can't keep up" signal we want.
 *  - `unbounded: true` mode ignores the target TPS and fires ops as fast as
 *    possible for the duration — used for peak-throughput scenarios
 *    (event_throughput).
 *
 * No external benchmarking libraries — uses `process.memoryUsage()`,
 * `process.cpuUsage()`, and `performance.now()` only.
 */
import {
  SimpleLatencyHistogram,
  type BenchmarkResult,
  type BenchmarkSuite,
  type LatencyHistogram,
} from './types';

/** A function that performs one operation. May be sync or async. */
export type BenchFn = () => unknown | Promise<unknown>;

/** Options for `runBenchmark`. */
export interface RunBenchmarkOptions {
  /**
   * Maximum number of in-flight async operations. When the cap is reached,
   * the harness awaits at least one in-flight op before scheduling the next.
   * Default 256 — high enough to pipeline I/O, low enough to bound memory.
   */
  maxConcurrency?: number;
  /** Maximum number of latency samples to retain. Default 500_000. */
  maxSamples?: number;
  /**
   * If true, ignore `targetTps` and fire ops as fast as possible for the
   * duration. Used for peak-throughput measurements.
   */
  unbounded?: boolean;
  /** Optional note attached to the result (e.g. 'db unavailable'). */
  note?: string;
  /** Optional setup hook called once before the timed loop. */
  setup?: () => void | Promise<void>;
  /** Optional teardown hook called once after the timed loop. */
  teardown?: () => void | Promise<void>;
}

/**
 * Run `fn` at the target TPS for `durationMs`, collecting per-op latency.
 *
 * Returns a `BenchmarkResult` with actualTps, percentiles, errors, and
 * memory/CPU deltas.
 *
 * The harness NEVER throws — if `fn` throws, the error is counted and the run
 * continues. If `setup` throws, the result records a single error with a note.
 */
export async function runBenchmark(
  name: string,
  targetTps: number,
  durationMs: number,
  fn: BenchFn,
  opts: RunBenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const maxConcurrency = opts.maxConcurrency ?? 256;
  const maxSamples = opts.maxSamples ?? 500_000;
  const unbounded = opts.unbounded ?? false;
  const note = opts.note;

  // Run setup OUTSIDE the timed region — setup is not part of the measurement.
  if (opts.setup) {
    try {
      await opts.setup();
    } catch (e) {
      return {
        name,
        targetTps,
        actualTps: 0,
        totalOps: 0,
        durationMs: 0,
        latencyP50: 0,
        latencyP95: 0,
        latencyP99: 0,
        latencyMax: 0,
        errors: 1,
        memoryDeltaMB: 0,
        cpuUserMs: 0,
        cpuSystemMs: 0,
        note: `setup failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  const intervalMs = unbounded ? 0 : 1000 / Math.max(1, targetTps);
  const totalOps = unbounded
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Math.floor((durationMs / 1000) * targetTps));

  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const wallStart = performance.now();
  const wallEnd = wallStart + durationMs;

  const histogram: LatencyHistogram = new SimpleLatencyHistogram(maxSamples);
  let errors = 0;
  let completed = 0;
  let started = 0;

  const inflight = new Set<Promise<void>>();

  // Spin-wait for very tight intervals (high TPS); setTimeout for relaxed ones.
  // The 2ms cutoff is empirical — setTimeout has ~1ms resolution in Node/Bun,
  // so anything below 2ms is better served by a spin loop.
  const useSpinWait = intervalMs > 0 && intervalMs <= 2;

  const yieldToEventLoop = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  try {
    for (let i = 0; i < totalOps; i++) {
      // Stop if we've exceeded the duration (handles unbounded mode + safety).
      if (performance.now() >= wallEnd) break;

      if (!unbounded) {
        const desiredStart = wallStart + i * intervalMs;
        if (useSpinWait) {
          // Pure spin — pegs CPU but achieves the tightest scheduling.
          while (performance.now() < desiredStart) {
            // spin
          }
        } else {
          // Yield-based wait — cooperative, lets the event loop process I/O.
          let now = performance.now();
          while (now < desiredStart) {
            const wait = desiredStart - now;
            if (wait > 3) {
              // Long wait — use setTimeout for precision.
              await new Promise<void>((r) => setTimeout(r, Math.floor(wait - 1)));
            } else if (wait > 1) {
              // Brief wait — yield via setImmediate.
              await yieldToEventLoop();
            }
            now = performance.now();
          }
        }
      }

      // Throttle concurrency — if too many async ops are in flight, wait for
      // one to complete before starting another. Prevents unbounded memory.
      while (inflight.size >= maxConcurrency) {
        if (inflight.size === 0) break;
        await Promise.race(inflight);
      }

      started++;
      const opStart = performance.now();
      let result: unknown;
      try {
        result = fn();
      } catch {
        errors++;
        completed++;
        histogram.record(performance.now() - opStart);
        continue;
      }

      if (result && typeof (result as { then?: unknown }).then === 'function') {
        // Async op — track in inflight, resolve later.
        const p = (result as Promise<unknown>)
          .then(
            () => {
              histogram.record(performance.now() - opStart);
              completed++;
            },
            () => {
              // Record latency even on error — the op still took time.
              histogram.record(performance.now() - opStart);
              errors++;
              completed++;
            },
          )
          .finally(() => inflight.delete(p));
        inflight.add(p);
      } else {
        // Sync op — already done.
        histogram.record(performance.now() - opStart);
        completed++;
      }
    }

    // Wait for any remaining async ops to settle.
    if (inflight.size > 0) {
      await Promise.allSettled([...inflight]);
    }
  } finally {
    if (opts.teardown) {
      try {
        await opts.teardown();
      } catch {
        // Teardown errors are ignored — the benchmark result is still valid.
      }
    }
  }

  const actualEnd = performance.now();
  const actualDurationMs = actualEnd - wallStart;
  const cpuAfter = process.cpuUsage(cpuBefore);
  const memAfter = process.memoryUsage();

  const actualTps =
    completed > 0 && actualDurationMs > 0
      ? (completed / actualDurationMs) * 1000
      : 0;

  return {
    name,
    targetTps: unbounded ? -1 : targetTps,
    actualTps,
    totalOps: completed,
    durationMs: actualDurationMs,
    latencyP50: histogram.percentile(50),
    latencyP95: histogram.percentile(95),
    latencyP99: histogram.percentile(99),
    latencyMax: histogram.max(),
    errors,
    memoryDeltaMB: (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024,
    cpuUserMs: cpuAfter.user / 1000,
    cpuSystemMs: cpuAfter.system / 1000,
    note,
  };
}

/** A named benchmark with its target TPS, duration, and fn. */
export interface BenchmarkSpec {
  name: string;
  targetTps: number;
  durationMs: number;
  fn: BenchFn;
  opts?: RunBenchmarkOptions;
}

/**
 * Run multiple benchmarks sequentially and return a suite.
 * Each spec runs to completion before the next starts — this isolates
 * memory/CPU measurements per benchmark.
 */
export async function runSuite(
  suiteName: string,
  specs: BenchmarkSpec[],
): Promise<BenchmarkSuite> {
  // Lazy import to avoid circular deps at module load.
  const { captureEnvironment } = await import('./types');
  const results: BenchmarkResult[] = [];
  for (const spec of specs) {
    console.error(`  → running ${spec.name} @ ${spec.targetTps} TPS for ${spec.durationMs}ms …`);
    try {
      const result = await runBenchmark(
        spec.name,
        spec.targetTps,
        spec.durationMs,
        spec.fn,
        spec.opts,
      );
      results.push(result);
    } catch (e) {
      // Should never happen — runBenchmark catches internally. Defensive.
      results.push({
        name: spec.name,
        targetTps: spec.targetTps,
        actualTps: 0,
        totalOps: 0,
        durationMs: 0,
        latencyP50: 0,
        latencyP95: 0,
        latencyP99: 0,
        latencyMax: 0,
        errors: 1,
        memoryDeltaMB: 0,
        cpuUserMs: 0,
        cpuSystemMs: 0,
        note: `harness error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return {
    name: suiteName,
    results,
    runAt: new Date().toISOString(),
    environment: captureEnvironment(),
  };
}

/** Format a single result as a human-readable line. */
export function formatResult(r: BenchmarkResult): string {
  const tps = r.targetTps === -1 ? 'MAX' : String(r.targetTps);
  const note = r.note ? `  [${r.note}]` : '';
  return (
    `${r.name.padEnd(28)} target=${tps.padStart(5)}  ` +
    `actual=${r.actualTps.toFixed(1).padStart(9)} TPS  ` +
    `ops=${String(r.totalOps).padStart(7)}  ` +
    `p50=${fmt(r.latencyP50)}  p95=${fmt(r.latencyP95)}  ` +
    `p99=${fmt(r.latencyP99)}  max=${fmt(r.latencyMax)}  ` +
    `errs=${r.errors}  Δmem=${r.memoryDeltaMB.toFixed(2)}MB  ` +
    `cpu=${(r.cpuUserMs + r.cpuSystemMs).toFixed(1)}ms${note}`
  );
}

function fmt(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`.padStart(6);
  if (ms < 1000) return `${ms.toFixed(2)}ms`.padStart(7);
  return `${(ms / 1000).toFixed(2)}s `.padStart(7);
}

/**
 * Render the entire suite as a markdown document.
 *
 * Produces:
 *  - Environment header (runtime, platform, CPU, memory)
 *  - One markdown table per scenario (rows = TPS targets)
 *  - A summary section identifying which scenarios hit 10k TPS
 */
export function formatSuite(suite: BenchmarkSuite): string {
  const lines: string[] = [];
  lines.push(`# Benchmark Report — ${suite.name}`);
  lines.push('');
  lines.push(`**Run at:** ${suite.runAt}`);
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Runtime | ${suite.environment.runtime} |`);
  lines.push(`| Platform | ${suite.environment.platform} (${suite.environment.arch}) |`);
  lines.push(`| CPU cores | ${suite.environment.cpus} |`);
  lines.push(`| Total memory | ${suite.environment.totalMemoryMB} MB |`);
  lines.push(`| Process uptime | ${suite.environment.processUptimeSec} s |`);
  lines.push('');

  // Group results by scenario name.
  const byName = new Map<string, BenchmarkResult[]>();
  for (const r of suite.results) {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  }

  lines.push('## Results');
  lines.push('');

  for (const [name, results] of byName) {
    lines.push(`### ${name}`);
    lines.push('');
    lines.push(
      '| Target TPS | Actual TPS | Total Ops | p50 | p95 | p99 | Max | Errors | ΔMem (MB) | CPU (ms) | Duration (ms) | Note |',
    );
    lines.push(
      '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    );
    for (const r of results) {
      const tps = r.targetTps === -1 ? 'MAX' : String(r.targetTps);
      lines.push(
        `| ${tps} | ${r.actualTps.toFixed(1)} | ${r.totalOps} | ` +
          `${r.latencyP50.toFixed(3)} | ${r.latencyP95.toFixed(3)} | ` +
          `${r.latencyP99.toFixed(3)} | ${r.latencyMax.toFixed(3)} | ` +
          `${r.errors} | ${r.memoryDeltaMB.toFixed(2)} | ` +
          `${(r.cpuUserMs + r.cpuSystemMs).toFixed(1)} | ` +
          `${r.durationMs.toFixed(0)} | ${r.note ?? ''} |`,
      );
    }
    lines.push('');
  }

  // Summary section.
  lines.push('## Summary');
  lines.push('');
  lines.push('### 10k TPS attainment');
  lines.push('');
  lines.push('| Scenario | Target 10k | Actual TPS | p99 (ms) | Status |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const [name, results] of byName) {
    const tenK = results.find((r) => r.targetTps === 10_000);
    if (!tenK) continue;
    const status = tenK.actualTps >= 9_000 ? '✅ hit' : tenK.actualTps >= 1_000 ? '⚠️ partial' : '❌ bottlenecked';
    lines.push(
      `| ${name} | 10,000 | ${tenK.actualTps.toFixed(1)} | ${tenK.latencyP99.toFixed(3)} | ${status} |`,
    );
  }
  lines.push('');

  lines.push('### Bottlenecks identified');
  lines.push('');
  const bottlenecks: string[] = [];
  for (const [name, results] of byName) {
    for (const r of results) {
      if (r.targetTps <= 0) continue;
      if (r.actualTps < r.targetTps * 0.9) {
        const ratio = (r.actualTps / r.targetTps) * 100;
        bottlenecks.push(
          `- **${name}** @ ${r.targetTps} TPS: actual ${r.actualTps.toFixed(1)} TPS (${ratio.toFixed(0)}% of target), p99=${r.latencyP99.toFixed(3)}ms${r.note ? `, note: ${r.note}` : ''}`,
        );
      }
    }
  }
  if (bottlenecks.length === 0) {
    lines.push('All scenarios met ≥90% of their target TPS at every target.');
  } else {
    lines.push(...bottlenecks);
  }
  lines.push('');

  return lines.join('\n');
}
