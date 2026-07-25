/**
 * PaySwap Protocol — 20 Architecture Proof Scenarios.
 *
 * Each scenario is expressed purely as entities + capabilities + intents.
 * None of them require changing the solver or adding new runtime concepts.
 * If any workflow requires runtime changes, that's an architectural failure.
 *
 * These scenarios validate that the frozen v1.0 runtime can express the
 * complete PaySwap protocol without special cases.
 */
import { defaultScenario, type SimulationScenario, type CurrencyCode, type LiquidityProvider, type FinancialOperator, type FailureInjection } from '@/kernel';
import { uid } from '@/kernel/support';
import { createFiatProof, type FiatProof } from './economics/fiat-proof';

export interface ProtocolScenario {
  id: string;
  name: string;
  category: string;
  description: string;
  scenario: SimulationScenario;
  fiatProofs?: FiatProof[];
  expectedBehavior: string;
  validates: string[]; // what invariants this proves
}

/** Helper: create an LP. */
function lp(id: string, name: string, country: string, currency: CurrencyCode, capacity: number, fees: number, speed: number, manual: boolean = false): LiquidityProvider {
  return {
    id, name, country, currency, sourceKind: 'community_lp',
    twinTokenPosition: capacity * 0.5, fiatPosition: capacity,
    financialOperators: [], tradingFees: fees, tradingCapacity: capacity,
    riskProfile: 0.2, settlementSpeedMs: speed, insuranceCoverage: capacity * 0.5,
    availability: 0.95, historicalPerformance: 0.97, aiReputation: 0.85,
    manualOnly: manual, online: true,
  };
}

/** Helper: create a FO. */
function fo(id: string, type: any, name: string, country: string, currencies: CurrencyCode[], latencyMs: number, feeBps: number, uptime: number, max: number, min: number, routes: ('domestic' | 'cross_border')[]): FinancialOperator {
  return {
    id, type, name, country, supportedCurrencies: currencies,
    latencyMs, feeBps, feeFixed: 0, uptime, failureRate: 1 - uptime,
    maxAmount: max, minAmount: min, supportedRoutes: routes, online: true, manualOnly: false,
  };
}

/** Helper: create default proofs for LPs. */
function defaultProofs(lps: LiquidityProvider[], currency: CurrencyCode): FiatProof[] {
  return lps.map((lp) => createFiatProof(lp.id, 'open_banking_balance', currency, lp.tradingCapacity, 0.9, false, 'bank_api'));
}

/** The 20 architecture-proof scenarios. */
export function protocolScenarios(): ProtocolScenario[] {
  const base = defaultScenario();
  const cur = base.transaction.merchant.currency;

  return [
    // 1. Domestic payment
    {
      id: 'domestic-payment',
      name: 'Domestic Payment',
      category: 'Payment',
      description: 'Same-country payment — only FOs involved, no cross-border bridge needed.',
      scenario: {
        ...base,
        name: 'Domestic Payment',
        transaction: {
          ...base.transaction,
          type: 'domestic',
          buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' },
          merchant: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' },
          amount: 5000,
          currency: 'KES',
          priority: 'fastest',
        },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Single-country settlement via M-Pesa. No FX, no bridge.',
      validates: ['ledger-balanced', 'no-double-spend', 'replay-determinism'],
    },

    // 2. Cross-border with reserves in both countries
    {
      id: 'cross-border-both-reserves',
      name: 'Cross-border (reserves both)',
      category: 'Payment',
      description: 'Reserves exist in both origin and destination. Reserve-first routing.',
      scenario: {
        ...base,
        name: 'Cross-border (both reserves)',
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Reserve debit + bridge. Escrow freezes TwinGHS.',
      validates: ['escrow-conservation', 'twin-token-backed', 'reserve-threshold'],
    },

    // 3. Cross-border with reserve only in source
    {
      id: 'cross-border-source-reserve-only',
      name: 'Cross-border (source reserve only)',
      category: 'Payment',
      description: 'Only source country has a reserve. LP bridges to destination.',
      scenario: {
        ...base,
        name: 'Cross-border (source reserve only)',
        treasury: {
          ...base.treasury,
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 0, minThreshold: 0 },
        },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Source reserve + LP bridge. Mint TwinGHS, LP provides destination liquidity.',
      validates: ['twin-token-backed', 'lp-capacity-respected'],
    },

    // 4. Cross-border with reserve only in destination
    {
      id: 'cross-border-dest-reserve-only',
      name: 'Cross-border (dest reserve only)',
      category: 'Payment',
      description: 'Only destination has a reserve. Source LP bridges.',
      scenario: {
        ...base,
        name: 'Cross-border (dest reserve only)',
        treasury: {
          ...base.treasury,
          originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 },
        },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'LP bridge from source + destination reserve payout.',
      validates: ['twin-token-backed', 'reserve-threshold'],
    },

    // 5. LP-only routing
    {
      id: 'lp-only',
      name: 'LP Only Routing',
      category: 'Payment',
      description: 'No reserves used. Multiple LPs bridge the payment.',
      scenario: {
        ...base,
        name: 'LP Only',
        treasury: {
          ...base.treasury,
          originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 },
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 0, minThreshold: 0 },
        },
        policies: { ...base.policies, reservePolicy: 'lp_first' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Pure LP bridge. No reserve draw.',
      validates: ['lp-capacity-respected', 'no-negative-balances'],
    },

    // 6. Reserve depletion with LP fallback
    {
      id: 'reserve-depletion',
      name: 'Reserve Depletion + LP Fallback',
      category: 'Failure',
      description: 'Destination reserve exhausted mid-transaction. LP fallback via amendment.',
      scenario: {
        ...base,
        name: 'Reserve Depletion',
        treasury: {
          ...base.treasury,
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000, minThreshold: 10000 },
        },
        failures: [{ id: uid('fail'), type: 'reserve_exhaustion', label: 'Ghana reserve exhausted', targetId: 'Ghana', atFrame: 4 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Reserve draw fails → LP fallback amendment. Constitution flags threshold breach.',
      validates: ['fallback-path', 'reserve-threshold', 'constitution-violation-detection'],
    },

    // 7. Liquidity auction
    {
      id: 'liquidity-auction',
      name: 'Liquidity Auction',
      category: 'Auction',
      description: 'Large request triggers auction. Multiple LPs bid. Solver builds optimal mixture.',
      scenario: {
        ...base,
        name: 'Liquidity Auction',
        transaction: { ...base.transaction, amount: 100000, priority: 'cheapest' },
        liquidityProviders: [
          lp('1', 'Acacia LP', 'Kenya', 'GHS', 30000, 0.4, 50000, false),
          lp('2', 'Baobab LP', 'Kenya', 'GHS', 50000, 0.6, 45000, false),
          lp('3', 'Cooperative Pool', 'Kenya', 'GHS', 40000, 0.5, 55000, false),
        ],
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Auction opens, LPs bid, solver selects cheapest combination covering 100k.',
      validates: ['lp-capacity-respected', 'expected-cost-optimization'],
    },

    // 8. Manual settlement
    {
      id: 'manual-settlement',
      name: 'Manual Settlement',
      category: 'Settlement',
      description: 'LP cannot be auto-debited. Manual settlement workflow with proof.',
      scenario: {
        ...base,
        name: 'Manual Settlement',
        liquidityProviders: [
          lp('1', 'Acacia LP', 'Kenya', 'GHS', 50000, 1.1, 52000, true), // manualOnly
          lp('2', 'Baobab LP', 'Kenya', 'GHS', 10000, 0.8, 44000, false),
        ],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'LP draw → WAITING_FOR_LP_SETTLEMENT → LP proof → merchant confirm.',
      validates: ['manual-settlement-insured', 'escrow-conservation'],
    },

    // 9. Merchant dispute
    {
      id: 'merchant-dispute',
      name: 'Merchant Dispute',
      category: 'Dispute',
      description: 'Merchant opens dispute. Escrow frozen. Evidence + voting. Merchant wins.',
      scenario: {
        ...base,
        name: 'Merchant Dispute',
        failures: [{ id: uid('fail'), type: 'insurance_claim', label: 'Merchant dispute', atFrame: 5 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Dispute opens, escrow frozen, evidence collected, merchant wins, escrow slashed to merchant.',
      validates: ['escrow-conservation', 'no-duplicate-settlement'],
    },

    // 10. LP dispute (LP wins)
    {
      id: 'lp-dispute',
      name: 'LP Dispute (LP wins)',
      category: 'Dispute',
      description: 'Merchant disputes but LP proves settlement. LP wins, escrow returned.',
      scenario: {
        ...base,
        name: 'LP Dispute',
        failures: [{ id: uid('fail'), type: 'insurance_claim', label: 'LP dispute - LP wins', atFrame: 5 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Dispute opens, LP provides proof, LP wins, escrow refunded to LP.',
      validates: ['escrow-conservation', 'evidence-required'],
    },

    // 11. Merchant withdraws frozen tokens
    {
      id: 'merchant-withdraw-escrow',
      name: 'Merchant Withdraws Frozen Tokens',
      category: 'Dispute',
      description: 'After winning dispute, merchant withdraws frozen Twin Tokens from escrow.',
      scenario: {
        ...base,
        name: 'Merchant Withdraws Escrow',
        failures: [
          { id: uid('fail'), type: 'fraud_alert', label: 'LP fraud', atFrame: 3 } as FailureInjection,
          { id: uid('fail'), type: 'insurance_claim', label: 'Merchant claim', atFrame: 5 } as FailureInjection,
        ],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Fraud detected → dispute → merchant wins → escrow slashed to merchant.',
      validates: ['escrow-conservation', 'collateral-slash', 'no-double-spend'],
    },

    // 12. Replacement LP settlement
    {
      id: 'replacement-lp',
      name: 'Replacement LP Settlement',
      category: 'Dispute',
      description: 'Merchant wins dispute, requests replacement LP to complete settlement.',
      scenario: {
        ...base,
        name: 'Replacement LP',
        failures: [{ id: uid('fail'), type: 'manual_settlement_required', label: 'Manual settlement required', atFrame: 4 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Manual settlement fails → dispute → merchant requests replacement → new LP settles → escrow transfers.',
      validates: ['escrow-transfer', 'no-duplicate-settlement', 'fallback-path'],
    },

    // 13. LP collateral slashing
    {
      id: 'collateral-slashing',
      name: 'LP Collateral Slashing',
      category: 'Fraud',
      description: 'LP commits fraud. Collateral slashed. Reputation decreased. Exposure reduced.',
      scenario: {
        ...base,
        name: 'Collateral Slashing',
        failures: [{ id: uid('fail'), type: 'fraud_alert', label: 'Forged evidence', atFrame: 3 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Fraud proven → collateral slash → reputation slash → exposure cap → temporary suspension.',
      validates: ['collateral-conservation', 'exposure-limits'],
    },

    // 14. Merchant becomes LP
    {
      id: 'merchant-becomes-lp',
      name: 'Merchant Becomes LP',
      category: 'LP Lifecycle',
      description: 'Merchant opts into LP mode. Stakes Twin Tokens. Becomes liquidity provider.',
      scenario: {
        ...base,
        name: 'Merchant → LP',
        liquidityProviders: [
          ...base.liquidityProviders,
          lp('merchant-lp', 'Merchant LP', 'Ghana', 'GHS', 15000, 0.9, 48000, false),
        ],
        transaction: { ...base.transaction, priority: 'impact' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Merchant entity gains canStake capability. Stakes TwinGHS. Becomes LP.',
      validates: ['entity-capability-driven', 'lp-onboarding'],
    },

    // 15. LP withdrawal
    {
      id: 'lp-withdrawal',
      name: 'LP Withdrawal',
      category: 'LP Lifecycle',
      description: 'LP requests withdrawal. Drains position. Exits.',
      scenario: {
        ...base,
        name: 'LP Withdrawal',
        liquidityProviders: [
          lp('1', 'Acacia LP', 'Kenya', 'GHS', 50000, 1.1, 52000, false),
          // LP 2 and 3 removed — simulating LP 2 and 3 having already exited
        ],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs([lp('1', 'Acacia LP', 'Kenya', 'GHS', 50000, 1.1, 52000, false)], cur),
      expectedBehavior: 'LP lifecycle: active → draining → withdraw_requested → exited.',
      validates: ['lp-lifecycle', 'exposure-limits'],
    },

    // 16. Treasury rebalance
    {
      id: 'treasury-rebalance',
      name: 'Treasury Rebalance',
      category: 'Treasury',
      description: 'Reserve low. Treasury borrows LP liquidity. Rebalances reserves.',
      scenario: {
        ...base,
        name: 'Treasury Rebalance',
        treasury: {
          ...base.treasury,
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 12000, minThreshold: 10000 },
          stablecoinBalance: 100000,
        },
        transaction: { ...base.transaction, priority: 'balanced' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Treasury AI recommends replenish. Stablecoin converted to restore reserve.',
      validates: ['treasury-solvency', 'reserve-threshold'],
    },

    // 17. Net settlement cycle
    {
      id: 'net-settlement',
      name: 'Net Settlement Cycle',
      category: 'Settlement',
      description: 'Corridor obligations netted. Only delta settles.',
      scenario: {
        ...base,
        name: 'Net Settlement',
        transaction: { ...base.transaction, amount: 50000, priority: 'cheapest' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'Corridor obligations tracked. Gross volume > net volume. Only delta settles.',
      validates: ['net-settlement', 'no-duplicate-settlement'],
    },

    // 18. Stablecoin-assisted settlement
    {
      id: 'stablecoin-settlement',
      name: 'Stablecoin-Assisted Settlement',
      category: 'Treasury',
      description: 'Reserves unavailable. Stablecoin bridge used.',
      scenario: {
        ...base,
        name: 'Stablecoin Bridge',
        treasury: {
          ...base.treasury,
          originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 },
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 0, minThreshold: 0 },
          stablecoinBalance: 200000,
        },
        policies: { ...base.policies, reservePolicy: 'hybrid' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'No reserves → stablecoin treasury bridge. Lower carbon, preserves LP capacity.',
      validates: ['treasury-solvency', 'twin-token-backed'],
    },

    // 19. Mass LP exit stress test
    {
      id: 'mass-lp-exit',
      name: 'Mass LP Exit Stress Test',
      category: 'Stress',
      description: 'Multiple LPs exit simultaneously. Solver reroutes. Constitution verified.',
      scenario: {
        ...base,
        name: 'Mass LP Exit',
        liquidityProviders: [
          lp('1', 'Acacia LP', 'Kenya', 'GHS', 50000, 1.1, 52000, false),
          // LP 2 and 3 offline — simulating mass exit
          { ...lp('2', 'Baobab LP', 'Kenya', 'GHS', 10000, 0.8, 44000, false), online: false },
          { ...lp('3', 'Cooperative Pool', 'Kenya', 'GHS', 250000, 1.4, 61000, false), online: false },
        ],
        failures: [{ id: uid('fail'), type: 'network_partition', label: 'Mass LP exit', targetId: 'Kenya', atFrame: 2 } as FailureInjection],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      fiatProofs: defaultProofs([lp('1', 'Acacia LP', 'Kenya', 'GHS', 50000, 1.1, 52000, false)], cur),
      expectedBehavior: '2 LPs offline → solver reroutes to LP1 + treasury. Constitution checks exposure.',
      validates: ['fallback-path', 'availability', 'exposure-limits'],
    },

    // 20. Complete replay
    {
      id: 'complete-replay',
      name: 'Complete Replay',
      category: 'Replay',
      description: 'Full time-machine replay of every state transition. Deterministic.',
      scenario: {
        ...base,
        name: 'Complete Replay',
        transaction: { ...base.transaction, priority: 'balanced' },
      },
      fiatProofs: defaultProofs(base.liquidityProviders, cur),
      expectedBehavior: 'All transitions replayed in order. World state rebuilt from events. Deterministic hash.',
      validates: ['replay-determinism', 'event-determinism', 'snapshot-determinism', 'simulation-equals-production'],
    },
  ];
}

/** Constitutional test suite — every scenario must verify these invariants. */
export const CONSTITUTIONAL_TESTS = [
  'ledger-balanced',
  'twin-token-backed',
  'escrow-conservation',
  'collateral-conservation',
  'no-double-settlement',
  'no-negative-balances',
  'exposure-limits',
  'liquidity-limits',
  'merchant-validation',
  'customer-validation',
  'replay-determinism',
  'event-determinism',
  'snapshot-determinism',
  'simulation-equals-production',
] as const;
