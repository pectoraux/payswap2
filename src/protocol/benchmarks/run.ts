/**
 * PaySwap Protocol — Performance Benchmarks / Main Runner.
 * -----------------------------------------------------------------------------
 * `runAllBenchmarks` runs every scenario at the configured TPS targets
 * (default [10, 100, 1_000, 10_000]) for a short duration each. The duration
 * scales inversely with TPS — low TPS gets a longer window so we collect
 * enough samples for stable percentiles; high TPS gets a shorter window to
 * keep total wall-clock time reasonable.
 *
 * Returns a `BenchmarkSuite` + a markdown report string.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { formatSuite, runBenchmark, type BenchmarkSpec } from './harness';
import {
  ALL_SCENARIOS,
  SCENARIO_DESCRIPTIONS,
} from './scenarios';
import {
  captureEnvironment,
  type BenchmarkResult,
  type BenchmarkSuite,
} from './types';

/** Options for `runAllBenchmarks`. */
export interface RunAllOptions {
  /** TPS targets to test (default [10, 100, 1_000, 10_000]). */
  tpsTargets?: number[];
  /**
   * Duration per run in milliseconds. If a single number, applied to all TPS
   * targets. If a record, looked up by TPS target (falls back to 1_000ms).
   * Default: 2_000ms for TPS ≤ 100, 1_500ms for TPS ≤ 1_000, 1_000ms for
   * TPS > 1_000.
   */
  durationMs?: number | Record<number, number>;
  /** Suite name (default 'payswap-production-3'). */
  suiteName?: string;
  /**
   * Optional list of scenario names to include (whitelist). If omitted, all
   * scenarios run. Useful for quick iteration on a single scenario.
   */
  only?: string[];
}

const DEFAULT_TPS_TARGETS = [10, 100, 1_000, 10_000];

function defaultDurationForTps(tps: number): number {
  if (tps <= 100) return 2_000;
  if (tps <= 1_000) return 1_500;
  return 1_000;
}

/**
 * Run all scenarios at all TPS targets. Returns the suite + a markdown report.
 *
 * Each scenario factory is called once per TPS target — this gives the factory
 * a chance to reset state (e.g. a fresh LedgerEngine, fresh IdCounter).
 */
export async function runAllBenchmarks(
  opts: RunAllOptions = {},
): Promise<{ suite: BenchmarkSuite; report: string }> {
  const tpsTargets = opts.tpsTargets ?? DEFAULT_TPS_TARGETS;
  const suiteName = opts.suiteName ?? 'payswap-production-3';
  const only = opts.only;

  const results: BenchmarkResult[] = [];

  for (const factory of ALL_SCENARIOS) {
    let scenario;
    try {
      scenario = await factory();
    } catch (e) {
      // Factory threw — record a placeholder so the report shows it.
      const name = factory.name || 'unknown';
      console.error(`  ! scenario factory ${name} failed: ${e instanceof Error ? e.message : e}`);
      for (const tps of tpsTargets) {
        results.push({
          name,
          targetTps: tps,
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
          note: `factory failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      continue;
    }

    if (only && !only.includes(scenario.name)) continue;

    for (const tps of tpsTargets) {
      // Re-create the scenario for each TPS target so state is fresh.
      let instance = scenario;
      try {
        instance = await factory();
      } catch {
        // If the factory only works once (e.g. db check), reuse the first.
        instance = scenario;
      }

      const durationMs =
        typeof opts.durationMs === 'number'
          ? opts.durationMs
          : typeof opts.durationMs === 'object'
            ? opts.durationMs![tps] ?? defaultDurationForTps(tps)
            : defaultDurationForTps(tps);

      // For the unbounded scenario, target TPS is irrelevant — use a fixed
      // 1-second window.
      const effectiveTps = instance.opts?.unbounded ? 1 : tps;
      const effectiveDuration = instance.opts?.unbounded ? 1_000 : durationMs;

      console.error(
        `▶ ${instance.name.padEnd(28)} @ ${String(effectiveTps).padStart(5)} TPS for ${effectiveDuration}ms`,
      );

      try {
        const result = await runBenchmark(
          instance.name,
          effectiveTps,
          effectiveDuration,
          instance.fn,
          instance.opts,
        );
        // Preserve the scenario's note (e.g. 'db unavailable').
        if (instance.note && !result.note) result.note = instance.note;
        // For unbounded runs, report the configured TPS target as -1 (MAX).
        if (instance.opts?.unbounded) {
          result.targetTps = -1;
        }
        results.push(result);
      } catch (e) {
        results.push({
          name: instance.name,
          targetTps: instance.opts?.unbounded ? -1 : tps,
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
          note: `run failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  const suite: BenchmarkSuite = {
    name: suiteName,
    results,
    runAt: new Date().toISOString(),
    environment: captureEnvironment(),
  };

  const report = formatSuite(suite);
  return { suite, report };
}

/**
 * Save the markdown report to a file. Default path:
 * `/home/z/my-project/BENCHMARK-REPORT.md`.
 */
export function saveReport(
  report: string,
  path: string = '/home/z/my-project/BENCHMARK-REPORT.md',
): void {
  // Ensure the parent directory exists (handles relative paths).
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // Directory may already exist — ignore.
  }
  writeFileSync(path, report, 'utf-8');
}

/** Build the list of BenchmarkSpecs (for callers that want to use runSuite directly). */
export async function buildSpecs(
  tpsTargets: number[] = DEFAULT_TPS_TARGETS,
  durationMs?: number | Record<number, number>,
): Promise<BenchmarkSpec[]> {
  const specs: BenchmarkSpec[] = [];
  for (const factory of ALL_SCENARIOS) {
    const scenario = await factory();
    for (const tps of tpsTargets) {
      const dur =
        typeof durationMs === 'number'
          ? durationMs
          : typeof durationMs === 'object'
            ? durationMs[tps] ?? defaultDurationForTps(tps)
            : defaultDurationForTps(tps);
      const effectiveTps = scenario.opts?.unbounded ? 1 : tps;
      const effectiveDuration = scenario.opts?.unbounded ? 1_000 : dur;
      specs.push({
        name: scenario.name,
        targetTps: effectiveTps,
        durationMs: effectiveDuration,
        fn: scenario.fn,
        opts: scenario.opts,
      });
    }
  }
  return specs;
}

/** Re-export for convenience. */
export { SCENARIO_DESCRIPTIONS };
