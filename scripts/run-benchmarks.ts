#!/usr/bin/env bun
/**
 * PaySwap Protocol — Benchmark Runner Script.
 * -----------------------------------------------------------------------------
 * Task 3-I: Runs the full benchmark suite and saves the report to
 * `BENCHMARK-REPORT.md`. Runnable via:
 *
 *   cd /home/z/my-project && bun run scripts/run-benchmarks.ts
 *
 * Options (env vars):
 *   BENCH_TPS        — comma-separated TPS targets (default "10,100,1000,10000")
 *   BENCH_ONLY       — comma-separated scenario names to whitelist
 *   BENCH_DURATION   — duration per run in ms (default: adaptive)
 *   BENCH_REPORT_PATH — output path (default: BENCHMARK-REPORT.md)
 *
 * The script NEVER aborts on a single scenario failure — the error is recorded
 * in the result's `note` field and the suite continues.
 */
import { runAllBenchmarks, saveReport } from '@/protocol/benchmarks';

async function main(): Promise<void> {
  const tpsTargets = process.env.BENCH_TPS
    ? process.env.BENCH_TPS.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
    : [10, 100, 1_000, 10_000];

  const only = process.env.BENCH_ONLY
    ? process.env.BENCH_ONLY.split(',').map((s) => s.trim())
    : undefined;

  const durationMs = process.env.BENCH_DURATION
    ? Number(process.env.BENCH_DURATION)
    : undefined;

  const reportPath = process.env.BENCH_REPORT_PATH ?? '/home/z/my-project/BENCHMARK-REPORT.md';

  console.error('═══════════════════════════════════════════════════════════════');
  console.error('  PaySwap PRODUCTION-3 Benchmark Suite — Task 3-I');
  console.error(`  TPS targets: ${tpsTargets.join(', ')}`);
  if (only) console.error(`  Only: ${only.join(', ')}`);
  console.error('═══════════════════════════════════════════════════════════════');

  const startTs = Date.now();
  const { suite, report } = await runAllBenchmarks({
    tpsTargets,
    only,
    durationMs,
  });
  const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);

  saveReport(report, reportPath);

  // Print a concise summary to stderr (so it doesn't interfere with piping stdout).
  console.error('═══════════════════════════════════════════════════════════════');
  console.error(`  Done in ${elapsedSec}s — ${suite.results.length} results`);
  console.error(`  Report saved to: ${reportPath}`);
  console.error('═══════════════════════════════════════════════════════════════');

  // Print the full markdown report to stdout.
  console.log(report);

  // Exit 0 even if some scenarios had errors — the suite ran to completion.
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL: benchmark suite crashed:', e);
  process.exit(1);
});
