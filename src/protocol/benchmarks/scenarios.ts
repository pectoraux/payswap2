/**
 * PaySwap Protocol — Performance Benchmarks / Scenarios.
 * -----------------------------------------------------------------------------
 * Each scenario is a factory that returns a fresh `{ name, fn, opts }` triple.
 * The factory pattern lets `runAllBenchmarks` create a fresh instance per TPS
 * target so state from one run doesn't leak into the next.
 *
 * Scenarios:
 *  1.  planner_latency          — convergence planner solve (sync)
 *  2.  connector_open_banking   — PSD2 getBalance via ProductionConnector
 *  3.  connector_mpesa          — Daraja getBalance via ProductionConnector
 *  4.  connector_fx_rate        — FX getRate via ProductionConnector
 *  5.  connector_stellar_horizon — Horizon getAccount via ProductionConnector
 *  6.  connector_ethereum_rpc   — eth_getBalance via ProductionConnector
 *  7.  settlement_latency       — full Stellar twin-token transfer + verify
 *  8.  ledger_post_latency      — post a balanced journal entry (sync)
 *  9.  projection_latency_100   — rebuild ledger from 100 events
 *  10. projection_latency_1000  — rebuild ledger from 1,000 events
 *  11. projection_latency_10000 — rebuild ledger from 10,000 events
 *  12. event_throughput         — emit events (capped at target TPS)
 *  13. event_throughput_max     — emit events as fast as possible (unbounded)
 *  14. routing_latency          — findBestRoute through the liquidity network
 *  15. payout_e2e_latency       — quote → request → process (async)
 *  16. db_query_latency         — SELECT 1 via Prisma (skipped if no DB)
 *
 * Every scenario imports from kernel/protocol modules but NEVER modifies kernel
 * files. Setup happens inside the factory (or in `opts.setup`) so the timed
 * region contains only the operation under test.
 */
import { convergencePlanner, type ConvergenceIntent } from '@/kernel/planner';
import { eventEngine } from '@/kernel/event';
import { createEntity } from '@/kernel/entity';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import type { SimulationEvent, OptimizationWeights } from '@/kernel/types';

import { LedgerEngine } from '@/protocol/ledger/engine';
import { rebuildLedgerFromEvents } from '@/protocol/ledger/projection';

import {
  OpenBankingConnector,
  MpesaConnector,
  EthereumRpcConnector,
  FxRateConnector,
  StellarHorizonConnector,
} from '@/protocol/connectors-v2';
import type {
  ConnectorConfig,
  ConnectorId,
  ConnectorRequest,
} from '@/protocol/connectors-v2/types';
import type { ProductionConnector } from '@/protocol/connectors-v2/base';

import {
  stellarChainAdapter,
  stellarNetwork,
} from '@/protocol/chains/stellar/adapter';

import { liquidityRegistry } from '@/protocol/liquidity-network/registry';
import { findBestRoute } from '@/protocol/liquidity-network/routing';
import { lpHealthMonitor } from '@/protocol/liquidity-network/health';
import { capacityReservations } from '@/protocol/liquidity-network/capacity';
import type { Corridor } from '@/protocol/liquidity-network/types';

import { payoutService } from '@/protocol/payouts/payout-service';
import { twinTokenEngine } from '@/protocol/twin-token/engine';

import type { BenchFn, RunBenchmarkOptions } from './harness';

/** A benchmark scenario — name + fn + optional opts/note. */
export interface BenchmarkScenario {
  name: string;
  fn: BenchFn;
  opts?: RunBenchmarkOptions;
  note?: string;
}

/** A factory that produces a fresh scenario instance (with fresh state). */
export type ScenarioFactory = () => BenchmarkScenario | Promise<BenchmarkScenario>;

/* ========================================================================== */
/* 1. Planner latency                                                          */
/* ========================================================================== */

/** Build a fixed convergence intent with reserves + LPs + treasury. */
function buildPlannerIntent(): ConvergenceIntent {
  const entities = [
    createEntity('reserve', 'Reserve Ghana', {
      id: 'reserve:GHS',
      state: 'healthy',
      country: 'Ghana',
      currency: 'GHS',
      balance: 100_000,
      capabilities: { canDebit: true, canCredit: true },
      policies: { feeBps: 5, minThreshold: 10_000 },
      attributes: { latencyMs: 8_000 },
    }),
    createEntity('lp', 'Acacia LP', {
      id: 'lp:acacia',
      state: 'active',
      country: 'Kenya',
      currency: 'GHS',
      balance: 50_000,
      capabilities: { canBridge: true },
      policies: { feeBps: 110 },
      attributes: { latencyMs: 5_200 },
    }),
    createEntity('lp', 'Baobab LP', {
      id: 'lp:baobab',
      state: 'active',
      country: 'Kenya',
      currency: 'GHS',
      balance: 10_000,
      capabilities: { canBridge: true },
      policies: { feeBps: 80 },
      attributes: { latencyMs: 4_400 },
    }),
    createEntity('lp', 'Cooperative Pool', {
      id: 'lp:coop',
      state: 'active',
      country: 'Kenya',
      currency: 'GHS',
      balance: 250_000,
      capabilities: { canBridge: true },
      policies: { feeBps: 140 },
      attributes: { latencyMs: 6_100 },
    }),
    createEntity('treasury', 'Treasury', {
      id: 'treasury:ghs',
      state: 'active',
      country: 'Kenya',
      currency: 'GHS',
      balance: 50_000,
      capabilities: { canSwap: true },
      policies: { feeBps: 30 },
      attributes: { latencyMs: 5_000 },
    }),
  ];
  const now = Date.now();
  const evidence = [
    createEvidence({
      type: 'attestation',
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId: 'lp:acacia',
      attestedAmount: 48_000,
      currency: 'GHS',
      reputation: 0.9,
      attester: 'open_banking',
      ttlMs: 3_600_000,
      payload: { balance: 48_000 },
    }),
    createEvidence({
      type: 'attestation',
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId: 'lp:baobab',
      attestedAmount: 9_500,
      currency: 'GHS',
      reputation: 0.85,
      attester: 'open_banking',
      ttlMs: 3_600_000,
      payload: { balance: 9_500 },
    }),
    createEvidence({
      type: 'attestation',
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId: 'lp:coop',
      attestedAmount: 240_000,
      currency: 'GHS',
      reputation: 0.92,
      attester: 'open_banking',
      ttlMs: 3_600_000,
      payload: { balance: 240_000 },
    }),
  ];
  // Suppress unused-var warning for `now` — it's used by the planner internally.
  void now;
  const objectives: OptimizationWeights = {
    cost: 0.7,
    speed: 0.1,
    safety: 0.2,
    liquidityPreservation: 0.2,
    merchantSatisfaction: 0.3,
    communityImpact: 0.05,
    carbonImpact: 0.05,
    treasuryHealth: 0.3,
  };
  return {
    currentWorld: { entities, evidence },
    desiredWorld: {
      deltas: [
        {
          entityId: 'merchant:1',
          amount: 25_000,
          command: 'BridgeLiquidity',
          capability: 'canBridge',
          fromState: 'pending',
          toState: 'settled',
        },
      ],
    },
    constraints: {
      maxCostPercent: 5,
      maxRiskScore: 0.6,
      maxSettlementMs: 300_000,
      minConfidence: 0.7,
    },
    objectives,
    policies: {
      reservePolicy: 'hybrid',
      maxLpShare: 0.7,
      requireInsurance: false,
    },
  };
}

/** Scenario: planner_latency. */
export function plannerLatencyScenario(): BenchmarkScenario {
  const intent = buildPlannerIntent();
  return {
    name: 'planner_latency',
    fn: () => convergencePlanner.converge(intent),
  };
}

/* ========================================================================== */
/* 2–6. Connector latency (5 production connectors)                           */
/* ========================================================================== */

/**
 * Build a benchmark connector with rate limits effectively disabled,
 * idempotency cache effectively disabled (TTL=1ms), and retries off.
 * Measures the raw doQuery + evidence + audit path latency.
 */
function makeBenchConnector<T extends ProductionConnector>(
  Ctor: new (config?: Partial<ConnectorConfig>) => T,
  id: ConnectorId,
): T {
  const c = new Ctor({
    id,
    rateLimitRps: 1_000_000,
    rateLimitBurst: 1_000_000,
    idempotencyTtlMs: 1,
    retryCount: 0,
    timeout: 5_000,
  });
  c.setApiKey('bench_api_keyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  c.setSecret('bench_hmac_secret_for_signing_evidence_payloads');
  return c;
}

/** A counter for unique idempotency keys per connector. */
class IdCounter {
  private n = 0;
  next(prefix: string): string {
    this.n++;
    return `${prefix}_${this.n}`;
  }
}

/** Scenario: connector_open_banking — getBalance operation. */
export function connectorOpenBankingScenario(): BenchmarkScenario {
  const connector = makeBenchConnector(OpenBankingConnector, 'open_banking');
  const ids = new IdCounter();
  const req: ConnectorRequest = {
    id: ids.next('ob'),
    operation: 'getBalance',
    params: { accountId: 'GB00123456', currency: 'GBP', expectedBalance: 50000 },
  };
  return {
    name: 'connector_open_banking',
    fn: () =>
      connector.query({
        ...req,
        id: ids.next('ob'),
      }),
    opts: { maxConcurrency: 512 },
  };
}

/** Scenario: connector_mpesa — getBalance operation. */
export function connectorMpesaScenario(): BenchmarkScenario {
  const connector = makeBenchConnector(MpesaConnector, 'mpesa');
  const ids = new IdCounter();
  const req: ConnectorRequest = {
    id: ids.next('mp'),
    operation: 'getBalance',
    params: { phoneNumber: '+254712345678' },
  };
  return {
    name: 'connector_mpesa',
    fn: () =>
      connector.query({
        ...req,
        id: ids.next('mp'),
      }),
    opts: { maxConcurrency: 512 },
  };
}

/** Scenario: connector_fx_rate — getRate operation. */
export function connectorFxRateScenario(): BenchmarkScenario {
  const connector = makeBenchConnector(FxRateConnector, 'fx_rate');
  const ids = new IdCounter();
  const req: ConnectorRequest = {
    id: ids.next('fx'),
    operation: 'getRate',
    params: { fromCurrency: 'USD', toCurrency: 'KES' },
  };
  return {
    name: 'connector_fx_rate',
    fn: () =>
      connector.query({
        ...req,
        id: ids.next('fx'),
      }),
    opts: { maxConcurrency: 512 },
  };
}

/** Scenario: connector_stellar_horizon — getAccount operation. */
export function connectorStellarHorizonScenario(): BenchmarkScenario {
  const connector = makeBenchConnector(StellarHorizonConnector, 'stellar_horizon');
  const ids = new IdCounter();
  const req: ConnectorRequest = {
    id: ids.next('sh'),
    operation: 'getAccount',
    params: { address: 'GABCDEF1234567890' },
  };
  return {
    name: 'connector_stellar_horizon',
    fn: () =>
      connector.query({
        ...req,
        id: ids.next('sh'),
      }),
    opts: { maxConcurrency: 512 },
  };
}

/** Scenario: connector_ethereum_rpc — getBalance operation. */
export function connectorEthereumRpcScenario(): BenchmarkScenario {
  const connector = makeBenchConnector(EthereumRpcConnector, 'ethereum_rpc');
  const ids = new IdCounter();
  const req: ConnectorRequest = {
    id: ids.next('eth'),
    operation: 'getBalance',
    params: { address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' },
  };
  return {
    name: 'connector_ethereum_rpc',
    fn: () =>
      connector.query({
        ...req,
        id: ids.next('eth'),
      }),
    opts: { maxConcurrency: 512 },
  };
}

/* ========================================================================== */
/* 7. Settlement latency — Stellar twin-token transfer + verify               */
/* ========================================================================== */

const SETTLE_ASSET_CODE = 'TWINGHS';
const SETTLE_ISSUER = 'G_SETTLE_ISSUER';
const SETTLE_SENDER = 'G_SETTLE_SENDER';
const SETTLE_RECEIVER = 'G_SETTLE_RECEIVER';

/** Set up two accounts with trustlines + balances for the settlement benchmark. */
async function setupSettlementBenchmark(): Promise<void> {
  // Fund issuer + sender + receiver with native XLM for reserves.
  await stellarChainAdapter.createAccount({ address: SETTLE_ISSUER, nativeAmount: 10_000 });
  await stellarChainAdapter.createAccount({ address: SETTLE_SENDER, nativeAmount: 10_000 });
  await stellarChainAdapter.createAccount({ address: SETTLE_RECEIVER, nativeAmount: 10_000 });
  // Register the TWINGHS asset on stellar.
  await stellarChainAdapter.registerAsset({
    assetCode: SETTLE_ASSET_CODE,
    issuer: SETTLE_ISSUER,
  });
  // Create trustlines from sender + receiver to TWINGHS.
  await stellarChainAdapter.createTrustline({
    assetCode: SETTLE_ASSET_CODE,
    issuer: SETTLE_ISSUER,
    holder: SETTLE_SENDER,
  });
  await stellarChainAdapter.createTrustline({
    assetCode: SETTLE_ASSET_CODE,
    issuer: SETTLE_ISSUER,
    holder: SETTLE_RECEIVER,
  });
  // Issue a large balance of TWINGHS to the sender.
  await stellarChainAdapter.issueAsset({
    assetCode: SETTLE_ASSET_CODE,
    issuer: SETTLE_ISSUER,
    amount: 1_000_000_000,
    to: SETTLE_SENDER,
  });
}

/** Scenario: settlement_latency — transfer + verify on Stellar. */
export function settlementLatencyScenario(): BenchmarkScenario {
  return {
    name: 'settlement_latency',
    fn: async () => {
      const transfer = await stellarChainAdapter.transfer({
        assetCode: SETTLE_ASSET_CODE,
        amount: 1,
        from: SETTLE_SENDER,
        to: SETTLE_RECEIVER,
      });
      if (!transfer.success) throw new Error('transfer failed');
      // Verify via the adapter's verifyTransaction path.
      const verify = await stellarChainAdapter.verifyTransaction({
        txHash: transfer.txHash!,
      });
      if (!verify.success) throw new Error('verify failed');
      return verify;
    },
    opts: {
      maxConcurrency: 256,
      setup: setupSettlementBenchmark,
    },
  };
}

/* ========================================================================== */
/* 8. Ledger post latency                                                     */
/* ========================================================================== */

/** Scenario: ledger_post_latency — post a balanced journal entry. */
export function ledgerPostLatencyScenario(): BenchmarkScenario {
  // Fresh ledger per scenario instance — isolates from the singleton.
  const ledger = new LedgerEngine();
  let seq = 0;
  return {
    name: 'ledger_post_latency',
    fn: () =>
      ledger.postLines({
        txId: `bench_tx_${++seq}`,
        description: `Benchmark entry #${seq}`,
        lines: [
          {
            accountCode: 'cash:bank:GHS',
            amount: 100,
            currency: 'GHS',
            side: 'debit',
            memo: 'bench debit',
          },
          {
            accountCode: 'user:wallet:wallet_bench',
            amount: 100,
            currency: 'GHS',
            side: 'credit',
            memo: 'bench credit',
          },
        ],
      }),
  };
}

/* ========================================================================== */
/* 9–11. Projection latency (scales with N events)                            */
/* ========================================================================== */

/** Generate N deterministic events for the projection benchmark. */
function generateProjectionEvents(n: number): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const baseTs = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    const ts = baseTs + i * 100;
    const frame = Math.floor(i / 10);
    const kind = i % 10;
    if (kind < 3) {
      events.push({
        id: `evt_${i}`,
        type: 'twintoken.minted',
        ts,
        frame,
        payload: {
          opId: `op_${i}`,
          assetCode: 'TWINGHS',
          amount: 100 + i,
          to: `merchant:${i % 5}`,
          txHash: `tx_${i}`,
        },
      });
    } else if (kind < 5) {
      events.push({
        id: `evt_${i}`,
        type: 'twintoken.burned',
        ts,
        frame,
        payload: {
          opId: `op_${i}`,
          assetCode: 'TWINGHS',
          amount: 50,
          from: `merchant:${i % 5}`,
          txHash: `tx_${i}`,
        },
      });
    } else if (kind < 7) {
      events.push({
        id: `evt_${i}`,
        type: 'twintoken.transferred',
        ts,
        frame,
        payload: {
          opId: `op_${i}`,
          assetCode: 'TWINGHS',
          amount: 25,
          from: `merchant:${i % 5}`,
          to: `merchant:${(i + 1) % 5}`,
          txHash: `tx_${i}`,
        },
      });
    } else if (kind < 8) {
      events.push({
        id: `evt_${i}`,
        type: 'wallet.credited',
        ts,
        frame,
        payload: {
          walletId: `wallet_${i % 5}`,
          amount: 200,
          currency: 'GHS',
          counterparty: 'lp:acacia',
          reference: `ref_${i}`,
        },
      });
    } else if (kind < 9) {
      events.push({
        id: `evt_${i}`,
        type: 'wallet.debited',
        ts,
        frame,
        payload: {
          walletId: `wallet_${i % 5}`,
          amount: 50,
          currency: 'GHS',
          counterparty: 'lp:baobab',
          reference: `ref_${i}`,
        },
      });
    } else {
      events.push({
        id: `evt_${i}`,
        type: 'payout.completed',
        ts,
        frame,
        payload: {
          payoutId: `payout_${i}`,
          merchantId: `${i % 5}`,
          method: 'bank',
          netAmount: 75,
          currency: 'GHS',
          txHash: `tx_${i}`,
          evidenceSource: 'open_banking',
        },
      });
    }
  }
  return events;
}

/** Build a projection scenario for N events. */
function projectionScenario(n: number): BenchmarkScenario {
  const events = generateProjectionEvents(n);
  return {
    name: `projection_latency_${n}`,
    fn: () => rebuildLedgerFromEvents(events),
  };
}

/** Scenario: projection_latency_100. */
export function projectionLatency100Scenario(): BenchmarkScenario {
  return projectionScenario(100);
}

/** Scenario: projection_latency_1000. */
export function projectionLatency1000Scenario(): BenchmarkScenario {
  return projectionScenario(1_000);
}

/** Scenario: projection_latency_10000. */
export function projectionLatency10000Scenario(): BenchmarkScenario {
  return projectionScenario(10_000);
}

/* ========================================================================== */
/* 12–13. Event throughput                                                     */
/* ========================================================================== */

/** Scenario: event_throughput — emit events at the target TPS (capped). */
export function eventThroughputScenario(): BenchmarkScenario {
  let n = 0;
  return {
    name: 'event_throughput',
    fn: () =>
      eventEngine.emit(
        'bench.tick',
        { n: ++n, ts: Date.now() },
        0,
      ),
    opts: {
      setup: () => {
        eventEngine.reset();
      },
    },
  };
}

/** Scenario: event_throughput_max — emit events as fast as possible. */
export function eventThroughputMaxScenario(): BenchmarkScenario {
  let n = 0;
  return {
    name: 'event_throughput_max',
    fn: () =>
      eventEngine.emit(
        'bench.burst',
        { n: ++n, ts: Date.now() },
        0,
      ),
    opts: {
      unbounded: true,
      setup: () => {
        eventEngine.reset();
      },
    },
  };
}

/* ========================================================================== */
/* 14. Routing latency                                                         */
/* ========================================================================== */

const BENCH_CORRIDOR: Corridor = { fromCurrency: 'GHS', toCurrency: 'KES' };

/** Set up LPs in the liquidity registry for the routing benchmark. */
function setupRoutingBenchmark(): void {
  liquidityRegistry.reset();
  capacityReservations.reset();
  // Register 5 LPs with varying capacity + fees on the GHS→KES corridor.
  for (let i = 1; i <= 5; i++) {
    liquidityRegistry.register({
      id: `bench_lp_${i}`,
      name: `Bench LP ${i}`,
      country: i % 2 === 0 ? 'Kenya' : 'Ghana',
      corridors: [BENCH_CORRIDOR],
      state: 'active',
      capacity: { 'GHS→KES': 1_000_000 },
      reputation: 0.8 + i * 0.02,
      tier: i === 1 ? 'premium' : 'standard',
      feeBps: 50 + i * 20,
      settlementSpeedMs: 5_000 + i * 1_000,
      historicalSuccessRate: 0.95,
    });
  }
  // Mark all LPs as healthy (no failures → healthy by default).
  for (let i = 1; i <= 5; i++) {
    lpHealthMonitor.recordRecovery(`bench_lp_${i}`);
  }
}

/** Scenario: routing_latency — findBestRoute on GHS→KES. */
export function routingLatencyScenario(): BenchmarkScenario {
  return {
    name: 'routing_latency',
    fn: () => findBestRoute(BENCH_CORRIDOR, 5_000, {}),
    opts: { setup: setupRoutingBenchmark },
  };
}

/* ========================================================================== */
/* 15. Payout end-to-end latency                                               */
/* ========================================================================== */

const PAYOUT_MERCHANT_ID = 'bench';
const PAYOUT_HOLDER = 'merchant:bench';
const PAYOUT_ASSET = 'TWINGHS';
const PAYOUT_ISSUER = 'G_PAYOUT_ISSUER';
const PAYOUT_BANK_ACCOUNT = 'GHA123456789';

/** Set up the merchant with a large TWINGHS balance for the payout benchmark. */
async function setupPayoutBenchmark(): Promise<void> {
  // Fund issuer + merchant accounts on stellar with XLM for reserves.
  // The issuer gets a HUGE XLM balance because the legacy `stellarAdapter.transfer()`
  // wrapper (used by twinTokenEngine.mint) does not pass the `issuer` parameter
  // to the new chain adapter, causing `resolveAsset()` to treat non-native
  // assets as native (XLM). The transfer "succeeds" by moving XLM, and the
  // twin token engine credits the TWINGHS balance based on the success flag.
  // This is a known system bug (documented in the benchmark report) — we work
  // around it by giving the issuer enough XLM to never exhaust.
  await stellarChainAdapter.createAccount({
    address: PAYOUT_ISSUER,
    nativeAmount: 1_000_000_000,
  });
  await stellarChainAdapter.createAccount({
    address: PAYOUT_HOLDER,
    nativeAmount: 1_000_000_000,
  });
  // Register TWINGHS asset on stellar.
  await stellarChainAdapter.registerAsset({
    assetCode: PAYOUT_ASSET,
    issuer: PAYOUT_ISSUER,
  });
  // Create trustline from merchant holder to TWINGHS.
  await stellarChainAdapter.createTrustline({
    assetCode: PAYOUT_ASSET,
    issuer: PAYOUT_ISSUER,
    holder: PAYOUT_HOLDER,
  });
  // Register the asset in the twin token engine.
  if (!twinTokenEngine.getAsset(PAYOUT_ASSET)) {
    await twinTokenEngine.registerAsset('GHS', 'Kenya→Ghana', PAYOUT_ISSUER);
  }
  // Mint a large balance to the merchant holder.
  // Re-mint if balance is low (idempotent across multiple TPS runs).
  const currentBalance = twinTokenEngine.getAvailableBalance(PAYOUT_HOLDER, PAYOUT_ASSET);
  if (currentBalance < 1_000_000) {
    await twinTokenEngine.mint(PAYOUT_ASSET, 100_000_000, PAYOUT_HOLDER);
  }
}

/** Scenario: payout_e2e_latency — quote → request → process. */
export function payoutE2ELatencyScenario(): BenchmarkScenario {
  return {
    name: 'payout_e2e_latency',
    fn: async () => {
      const params = {
        merchantId: PAYOUT_MERCHANT_ID,
        method: 'bank' as const,
        sourceAsset: PAYOUT_ASSET,
        sourceAmount: 1,
        sourceCurrency: 'GHS',
        destinationCurrency: 'GHS',
        destination: { bankAccount: PAYOUT_BANK_ACCOUNT, accountName: 'Bench Merchant' },
      };
      const quote = await payoutService.quote(params);
      const payout = await payoutService.request(params);
      const processed = await payoutService.process(payout.id);
      if (processed.state !== 'completed') {
        throw new Error(`payout failed: ${processed.reason ?? 'unknown'}`);
      }
      return { quote, payoutId: payout.id, state: processed.state };
    },
    opts: {
      maxConcurrency: 64,
      setup: setupPayoutBenchmark,
    },
  };
}

/* ========================================================================== */
/* 16. DB query latency                                                        */
/* ========================================================================== */

/** Check whether the Prisma database is reachable (3s timeout). */
async function checkDbAvailable(): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db');
    const result = await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db connection timeout')), 3_000),
      ),
    ]);
    return Array.isArray(result) && result.length > 0;
  } catch {
    return false;
  }
}

/** Scenario: db_query_latency — SELECT 1 via Prisma. */
export async function dbQueryLatencyScenario(): Promise<BenchmarkScenario> {
  const available = await checkDbAvailable();
  if (!available) {
    return {
      name: 'db_query_latency',
      fn: () => {
        throw new Error('db unavailable');
      },
      note: 'db unavailable — skipped (Prisma could not connect within 3s)',
    };
  }
  const { db } = await import('@/lib/db');
  return {
    name: 'db_query_latency',
    fn: () => db.$queryRaw`SELECT 1`,
    opts: { maxConcurrency: 64 },
  };
}

/* ========================================================================== */
/* Registry — all scenario factories                                          */
/* ========================================================================== */

/**
 * All scenario factories in execution order. `runAllBenchmarks` calls each
 * factory once per TPS target.
 */
export const ALL_SCENARIOS: ScenarioFactory[] = [
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
];

/** Human-readable scenario descriptions (for the report). */
export const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  planner_latency: 'Kernel convergence planner — solve a fixed cross-border intent (sync)',
  connector_open_banking: 'Production Open Banking PSD2 getBalance via ProductionConnector',
  connector_mpesa: 'Production M-Pesa Daraja getBalance via ProductionConnector',
  connector_fx_rate: 'Production FX rate getRate (USD→KES) via ProductionConnector',
  connector_stellar_horizon: 'Production Stellar Horizon getAccount via ProductionConnector',
  connector_ethereum_rpc: 'Production Ethereum JSON-RPC eth_getBalance via ProductionConnector',
  settlement_latency: 'Full Stellar twin-token transfer + verifyTransaction (async)',
  ledger_post_latency: 'Post a balanced journal entry to a fresh LedgerEngine (sync)',
  projection_latency_100: 'Rebuild ledger from 100 events (sync, scales with N)',
  projection_latency_1000: 'Rebuild ledger from 1,000 events (sync, scales with N)',
  projection_latency_10000: 'Rebuild ledger from 10,000 events (sync, scales with N)',
  event_throughput: 'Emit events via kernel EventEngine at the target TPS (sync)',
  event_throughput_max: 'Emit events as fast as possible (unbounded — peak throughput)',
  routing_latency: 'findBestRoute through the liquidity network (GHS→KES, 5 LPs)',
  payout_e2e_latency: 'Full payout: quote → request → process (async, burns 1 TWINGHS)',
  db_query_latency: 'SELECT 1 via Prisma ($queryRaw)',
};

/** Helper for callers that want a uid-prefixed name. */
export function benchUid(prefix: string): string {
  return uid(prefix);
}
