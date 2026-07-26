/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Stress Tests.
 *
 * Reserve resilience stress testing. Pre-defined scenarios simulate
 * adverse events (corridor drain, LP default, currency depeg,
 * reserve loss) and project the impact on treasury reserves. The
 * service produces a `StressTestResult` per scenario indicating
 * whether the treasury would survive (passed = true), the reserve
 * impact, any shortfall vs. minimum required reserves, and an
 * estimated recovery time.
 *
 * Pre-defined scenarios:
 *   1. `corridor_drain_30pct`   — 30% of corridor reserves drained.
 *   2. `lp_default_largest`     — largest LP exits (their committed
 *                                 capital is unavailable for 7 days).
 *   3. `currency_depeg_10pct`   — 10% depeg of a Twin Token (reserve
 *                                 loses 10% of its backing value).
 *   4. `reserve_loss_25pct`     — 25% outright reserve loss (custodian
 *                                 hack / bank failure).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.stress_test_completed` — after each scenario runs.
 *
 * The kernel is FROZEN — this module imports only `nowTs`, `uid`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  ReserveAccount,
  StressShock,
  StressShockType,
  StressTestResult,
  StressTestScenario,
} from './types';
import { reserveMonitor } from './reserve-monitor';
import { corridorFundingService } from './corridor-funding';
import { lpProfitabilityService } from './lp-profitability';

/** Default pre-defined stress test scenarios. */
export const DEFAULT_STRESS_SCENARIOS: StressTestScenario[] = [
  {
    id: 'corridor_drain_30pct',
    name: '30% Corridor Drain',
    description: 'A sudden 30% drain of corridor reserves (mass redemption event in a single corridor).',
    shock: { type: 'corridor_drain', magnitude: 0.30 },
    projectedImpact: 'Reduces corridor-reserve allocation by 30%; tests whether residual reserves cover circulating supply.',
  },
  {
    id: 'lp_default_largest',
    name: 'Largest LP Default',
    description: 'The largest LP (by committed capital) exits; their committed liquidity is unavailable for 7 days.',
    shock: { type: 'lp_default', magnitude: 1.0 },
    projectedImpact: 'Largest LP capital unavailable for 7 days; tests whether remaining LPs + treasury can absorb the gap.',
  },
  {
    id: 'currency_depeg_10pct',
    name: '10% Currency Depeg',
    description: 'A 10% depeg of a Twin Token (TWIN<CCY> trades at 0.90 on secondary markets).',
    shock: { type: 'currency_depeg', magnitude: 0.10 },
    projectedImpact: 'Backing value drops 10%; tests whether the treasury has excess reserves to absorb the depeg.',
  },
  {
    id: 'reserve_loss_25pct',
    name: '25% Reserve Loss',
    description: 'A 25% outright reserve loss (custodian hack or bank failure).',
    shock: { type: 'reserve_loss', magnitude: 0.25 },
    projectedImpact: 'Direct 25% reduction in fiat reserves; tests whether residual reserves still back circulating supply.',
  },
];

/** Minimum required reserve fraction per currency (default 1.0 = 100% backed). */
const MIN_RESERVE_FRACTION = 1.0;

/** Estimated LP capital return time after default (ms). */
const LP_DEFAULT_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Estimated corridor drain recovery time (ms). */
const CORRIDOR_DRAIN_RECOVERY_MS = 3 * 24 * 60 * 60 * 1000;

/** Estimated depeg recovery time (ms). */
const DEPEG_RECOVERY_MS = 14 * 24 * 60 * 60 * 1000;

/** Estimated reserve loss recovery time (ms). */
const RESERVE_LOSS_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Stress test service — runs scenarios against the current treasury
 * state and produces results.
 */
export class StressTestService {
  private scenarios: Map<string, StressTestScenario> = new Map();
  private results: StressTestResult[] = [];
  /** Minimum required reserve fraction (per currency). */
  private minReserveFraction = MIN_RESERVE_FRACTION;

  constructor() {
    // Pre-load default scenarios.
    for (const s of DEFAULT_STRESS_SCENARIOS) {
      this.scenarios.set(s.id, s);
    }
  }

  /** Set the minimum required reserve fraction (e.g. 1.0 = 100% backed). */
  setMinReserveFraction(fraction: number): void {
    this.minReserveFraction = Math.max(0, fraction);
  }

  /** Add / replace a scenario. */
  addScenario(scenario: StressTestScenario): void {
    this.scenarios.set(scenario.id, scenario);
  }

  /** All configured scenarios. */
  allScenarios(): StressTestScenario[] {
    return [...this.scenarios.values()];
  }

  /** Get a scenario by id. */
  getScenario(id: string): StressTestScenario | undefined {
    return this.scenarios.get(id);
  }

  /** Past results (most recent last). */
  getResults(): StressTestResult[] {
    return [...this.results];
  }

  /**
   * Run a single scenario. Reads the current treasury state
   * (reserves, corridor allocations, LP capital), applies the
   * shock, projects the post-shock reserves, and computes the
   * shortfall + recovery time.
   */
  runScenario(scenario: StressTestScenario): StressTestResult {
    const baseline = reserveMonitor.allReserves();
    const corridorReserves = corridorFundingService.allCorridorReserves();
    const postShockReserves = this.applyShock(scenario.shock, baseline, corridorReserves);
    const reserveImpact = this.computeReserveImpact(baseline, postShockReserves);
    const shortfall = this.computeShortfall(postShockReserves);
    const recoveryTimeMs = this.estimateRecoveryTime(scenario.shock, shortfall);
    const passed = shortfall <= 0;
    const recommendation = this.recommendation(scenario, shortfall, recoveryTimeMs);
    const result: StressTestResult = {
      scenarioId: scenario.id,
      passed,
      reserveImpact,
      shortfall,
      recoveryTimeMs,
      recommendation,
      postShockReserves: postShockReserves.map((r) => ({
        currency: r.currency,
        balance: r.balance,
        available: r.available,
      })),
      ts: nowTs(),
    };
    this.results.push(result);
    eventEngine.emit('treasury.stress_test_completed', {
      scenarioId: scenario.id,
      passed,
      reserveImpact,
      shortfall,
      recoveryTimeMs,
      recommendation,
    });
    return result;
  }

  /** Run all configured scenarios. Returns one result per scenario. */
  runAllScenarios(): StressTestResult[] {
    return this.allScenarios().map((s) => this.runScenario(s));
  }

  /**
   * Construct + run a custom scenario in one call.
   *
   *  - `id`           — opaque scenario id.
   *  - `shockType`    — one of the `StressShockType` values.
   *  - `magnitude`    — shock magnitude (fraction or absolute).
   *  - `target`       — optional target (corridor key, lpId, currency).
   */
  customScenario(params: {
    id: string;
    name?: string;
    description?: string;
    shockType: StressShockType;
    magnitude: number;
    target?: string;
  }): StressTestResult {
    const shock: StressShock = {
      type: params.shockType,
      magnitude: params.magnitude,
      target: params.target,
    };
    const scenario: StressTestScenario = {
      id: params.id,
      name: params.name ?? `Custom ${params.shockType}`,
      description: params.description ?? `Custom ${params.shockType} shock of magnitude ${params.magnitude}.`,
      shock,
      projectedImpact: 'Custom shock — see shock parameters.',
    };
    return this.runScenario(scenario);
  }

  // --------------------------------------------------------------- helpers

  /**
   * Apply a shock to the baseline reserves + corridor reserves.
   * Returns the post-shock reserve snapshot per currency.
   */
  private applyShock(
    shock: StressShock,
    baseline: ReserveAccount[],
    corridorReserves: Array<{ corridor: { from: string; to: string }; amount: number; currency: string }>,
  ): ReserveAccount[] {
    // Clone the baseline.
    const post: ReserveAccount[] = baseline.map((r) => ({ ...r }));
    switch (shock.type) {
      case 'corridor_drain': {
        // Drain `magnitude` fraction of corridor-reserved funds from
        // each currency that backs a corridor.
        const drainedPerCurrency = new Map<string, number>();
        for (const cr of corridorReserves) {
          const drained = cr.amount * shock.magnitude;
          drainedPerCurrency.set(cr.currency, (drainedPerCurrency.get(cr.currency) ?? 0) + drained);
        }
        for (const r of post) {
          const drained = drainedPerCurrency.get(r.currency) ?? 0;
          r.balance = Math.max(0, r.balance - drained);
          r.available = Math.max(0, r.available - drained);
        }
        break;
      }
      case 'lp_default': {
        // Reduce available reserve by the largest LP's committed capital.
        // We approximate "largest LP" by the max committed capital
        // across all LPs (in any currency — we attribute the loss
        // proportionally across currencies).
        const topLPs = lpProfitabilityService.getTopLPs('volume', 1);
        if (topLPs.length === 0) break;
        // The LP's committed capital — read from the LP service.
        const capital = lpProfitabilityService.getCommittedCapital(topLPs[0].lpId);
        if (capital <= 0 || post.length === 0) break;
        // Distribute the capital loss proportionally across currencies.
        const totalBalance = post.reduce((acc, r) => acc + r.balance, 0);
        if (totalBalance <= 0) break;
        for (const r of post) {
          const share = r.balance / totalBalance;
          const loss = capital * share;
          r.balance = Math.max(0, r.balance - loss);
          r.available = Math.max(0, r.available - loss);
        }
        break;
      }
      case 'currency_depeg': {
        // Depeg reduces the effective backing value of reserves by
        // `magnitude` for the targeted currency (or all if no target).
        for (const r of post) {
          if (shock.target && r.currency !== shock.target) continue;
          const loss = r.balance * shock.magnitude;
          r.balance = Math.max(0, r.balance - loss);
          r.available = Math.max(0, r.available - loss);
        }
        break;
      }
      case 'reserve_loss': {
        // Direct reserve loss: `magnitude` fraction of every currency's
        // balance is lost (custodian hack / bank failure).
        for (const r of post) {
          const loss = r.balance * shock.magnitude;
          r.balance = Math.max(0, r.balance - loss);
          r.available = Math.max(0, r.available - loss);
        }
        break;
      }
    }
    return post;
  }

  /** Total absolute reserve impact (positive = loss). */
  private computeReserveImpact(baseline: ReserveAccount[], post: ReserveAccount[]): number {
    const before = baseline.reduce((acc, r) => acc + r.balance, 0);
    const after = post.reduce((acc, r) => acc + r.balance, 0);
    return Math.max(0, before - after);
  }

  /**
   * Shortfall: the sum over currencies of max(0, required - available),
   * where `required = circulating_supply * minReserveFraction`. We
   * approximate circulating supply by the original reserve balance
   * (a stablecoin in circulation should be backed 1:1 by reserves).
   */
  private computeShortfall(post: ReserveAccount[]): number {
    let shortfall = 0;
    for (const r of post) {
      // Required = originalBalance * minReserveFraction. We don't have
      // the original circulating supply here, so we approximate by
      // the post-shock reserved (in-flight settlements must still be
      // covered). A real implementation reads the on-chain supply
      // from the backing verifier.
      const required = r.reserved * this.minReserveFraction;
      const deficit = Math.max(0, required - r.available);
      shortfall += deficit;
    }
    return shortfall;
  }

  /** Estimate the recovery time based on shock type + shortfall. */
  private estimateRecoveryTime(shock: StressShock, shortfall: number): number {
    if (shortfall <= 0) return 0;
    switch (shock.type) {
      case 'corridor_drain':
        return CORRIDOR_DRAIN_RECOVERY_MS;
      case 'lp_default':
        return LP_DEFAULT_RECOVERY_MS;
      case 'currency_depeg':
        return DEPEG_RECOVERY_MS;
      case 'reserve_loss':
        return RESERVE_LOSS_RECOVERY_MS;
      default:
        return RESERVE_LOSS_RECOVERY_MS;
    }
  }

  /** Generate a human-readable recommendation. */
  private recommendation(
    scenario: StressTestScenario,
    shortfall: number,
    recoveryTimeMs: number,
  ): string {
    if (shortfall <= 0) {
      return `${scenario.name}: treasury survives the shock with no reserve shortfall. No action required.`;
    }
    const days = Math.ceil(recoveryTimeMs / (24 * 60 * 60 * 1000));
    return `${scenario.name}: treasury faces a shortfall of ${shortfall.toFixed(2)}. ` +
      `Estimated recovery time: ${days} day(s). Recommend: increase corridor reserves, ` +
      `diversify LP exposure, and/or activate emergency liquidity facility.`;
  }

  /** Reset all results. */
  reset(): void {
    this.results = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_STRESS_TEST: StressTestService | undefined;
}

export const stressTestService: StressTestService =
  globalThis.__PAYSWAP_STRESS_TEST ?? new StressTestService();

if (!globalThis.__PAYSWAP_STRESS_TEST) {
  globalThis.__PAYSWAP_STRESS_TEST = stressTestService;
}
