/**
 * PaySwap Protocol — Performance Benchmarks / Barrel Export.
 * -----------------------------------------------------------------------------
 * Single import surface for the benchmark suite:
 *
 *   import {
 *     runAllBenchmarks, saveReport,
 *     runBenchmark, runSuite, formatResult, formatSuite,
 *     ALL_SCENARIOS, SCENARIO_DESCRIPTIONS,
 *     type BenchmarkResult, type BenchmarkSuite, type BenchmarkScenario,
 *   } from '@/protocol/benchmarks';
 */
export {
  SimpleLatencyHistogram,
  captureEnvironment,
  type BenchmarkResult,
  type BenchmarkEnvironment,
  type BenchmarkSuite,
  type LatencyHistogram,
} from './types';

export {
  runBenchmark,
  runSuite,
  formatResult,
  formatSuite,
  type BenchFn,
  type BenchmarkSpec,
  type RunBenchmarkOptions,
} from './harness';

export {
  ALL_SCENARIOS,
  SCENARIO_DESCRIPTIONS,
  plannerLatencyScenario,
  connectorOpenBankingScenario,
  connectorMpesaScenario,
  connectorFxRateScenario,
  connectorStellarHorizonScenario,
  connectorEthereumRpcScenario,
  settlementLatencyScenario,
  ledgerPostLatencyScenario,
  projectionLatency100Scenario,
  projectionLatency1000Scenario,
  projectionLatency10000Scenario,
  eventThroughputScenario,
  eventThroughputMaxScenario,
  routingLatencyScenario,
  payoutE2ELatencyScenario,
  dbQueryLatencyScenario,
  type BenchmarkScenario,
  type ScenarioFactory,
} from './scenarios';

export {
  runAllBenchmarks,
  saveReport,
  buildSpecs,
  type RunAllOptions,
} from './run';
