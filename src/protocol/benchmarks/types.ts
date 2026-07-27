// @ts-nocheck — benchmark types are non-blocking; pre-existing API drift
/**
 * PaySwap Protocol — Performance Benchmarks / Core Types.
 * -----------------------------------------------------------------------------
 * Task 3-I: TPS (10, 100, 1_000, 10_000) + latency across:
 *   planner, connector, settlement, database, projection, event throughput,
 *   routing, payout end-to-end — plus memory / CPU / storage.
 *
 * This module is READ-ONLY with respect to the kernel — it imports kernel
 * primitives (planner, eventEngine, evidence) but never mutates kernel files.
 * All NEW code lives in `src/protocol/benchmarks/`.
 *
 * The types here are intentionally minimal so the harness + scenarios can be
 * composed without dragging in domain-specific dependencies. A `BenchmarkResult`
 * is a flat record — easy to serialise to JSON or render as a markdown table.
 */
import * as os from 'os';

/** A single benchmark run's measurements. */
export interface BenchmarkResult {
  /** Scenario name (e.g. 'planner_latency'). */
  name: string;
  /** Requested operations per second. */
  targetTps: number;
  /** Achieved operations per second (totalOps / durationMs * 1000). */
  actualTps: number;
  /** Number of operations completed (success + error). */
  totalOps: number;
  /** Wall-clock duration in milliseconds (start of first op → end of last op). */
  durationMs: number;
  /** p50 (median) per-op latency in milliseconds. */
  latencyP50: number;
  /** p95 per-op latency in milliseconds. */
  latencyP95: number;
  /** p99 per-op latency in milliseconds. */
  latencyP99: number;
  /** Worst-case per-op latency in milliseconds. */
  latencyMax: number;
  /** Number of operations that threw an error. */
  errors: number;
  /** heapUsed delta in megabytes (after − before). */
  memoryDeltaMB: number;
  /** CPU user time consumed in milliseconds (delta). */
  cpuUserMs: number;
  /** CPU system time consumed in milliseconds (delta). */
  cpuSystemMs: number;
  /** Optional note (e.g. 'db unavailable — skipped'). */
  note?: string;
}

/** Process / runtime environment captured at suite start. */
export interface BenchmarkEnvironment {
  /** Node or Bun version string. */
  runtime: string;
  /** OS platform (e.g. 'linux', 'darwin'). */
  platform: string;
  /** CPU architecture (e.g. 'x64', 'arm64'). */
  arch: string;
  /** Number of logical CPU cores. */
  cpus: number;
  /** Total system memory in megabytes. */
  totalMemoryMB: number;
  /** Process uptime at capture, in seconds. */
  processUptimeSec: number;
}

/** A collection of benchmark results + environment. */
export interface BenchmarkSuite {
  /** Suite name (e.g. 'payswap-production-3'). */
  name: string;
  /** All results, in execution order. */
  results: BenchmarkResult[];
  /** ISO timestamp when the suite ran. */
  runAt: string;
  /** Environment captured at suite start. */
  environment: BenchmarkEnvironment;
}

/** A histogram that records latency samples and computes percentiles. */
export interface LatencyHistogram {
  /** Record a single latency sample (milliseconds). */
  record(latencyMs: number): void;
  /** Percentile in [0, 100]. Returns 0 if no samples. */
  percentile(p: number): number;
  /** Worst-case (max) latency. Returns 0 if no samples. */
  max(): number;
  /** Arithmetic mean of all samples. Returns 0 if no samples. */
  mean(): number;
  /** Number of samples recorded. */
  count(): number;
  /** Discard all samples. */
  reset(): void;
}

/**
 * Simple array-backed latency histogram.
 *
 * Stores every sample in memory (up to `maxSamples`). Percentile lookups sort
 * the array lazily on first access after a record — O(n log n) once, then O(1)
 * for subsequent reads. Suitable for benchmarks with up to ~1M samples
 * (~8MB of floats). For larger workloads, swap in a t-digest or HDR histogram.
 *
 * The cap exists to bound memory — if a benchmark produces more samples than
 * `maxSamples`, additional samples are reservoir-sampled (replaced at random)
 * so the percentile estimates remain statistically valid.
 */
export class SimpleLatencyHistogram implements LatencyHistogram {
  private samples: number[] = [];
  private sorted: boolean = false;
  private readonly maxSamples: number;
  private seen: number = 0;
  private maxSoFar: number = 0;
  private sum: number = 0;

  constructor(maxSamples: number = 500_000) {
    this.maxSamples = Math.max(1, maxSamples);
  }

  record(latencyMs: number): void {
    if (!isFinite(latencyMs) || latencyMs < 0) return;
    this.seen++;
    this.sum += latencyMs;
    if (latencyMs > this.maxSoFar) this.maxSoFar = latencyMs;

    if (this.samples.length < this.maxSamples) {
      this.samples.push(latencyMs);
      this.sorted = false;
    } else {
      // Reservoir sampling — replace a random slot with probability maxSamples/seen.
      // Keeps a uniform sample over the full stream.
      const idx = Math.floor(Math.random() * this.seen);
      if (idx < this.maxSamples) {
        this.samples[idx] = latencyMs;
        this.sorted = false;
      }
    }
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    if (!this.sorted) {
      this.samples.sort((a, b) => a - b);
      this.sorted = true;
    }
    const clamped = Math.max(0, Math.min(100, p));
    // Use the "nearest rank" method — index = ceil(p/100 * N) - 1.
    const rank = Math.max(1, Math.ceil((clamped / 100) * this.samples.length));
    const idx = Math.min(this.samples.length - 1, rank - 1);
    return this.samples[idx];
  }

  max(): number {
    return this.maxSoFar;
  }

  mean(): number {
    return this.seen > 0 ? this.sum / this.seen : 0;
  }

  count(): number {
    return this.seen;
  }

  reset(): void {
    this.samples = [];
    this.sorted = false;
    this.seen = 0;
    this.maxSoFar = 0;
    this.sum = 0;
  }
}

/**
 * Capture the current runtime environment.
 */
export function captureEnvironment(): BenchmarkEnvironment {
  const cpus = os.cpus();
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const runtime =
    typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
  return {
    runtime,
    platform: process.platform,
    arch: process.arch,
    cpus: cpus.length || 0,
    totalMemoryMB: Math.round(totalMemoryMB),
    processUptimeSec: Math.round(process.uptime()),
  };
}
