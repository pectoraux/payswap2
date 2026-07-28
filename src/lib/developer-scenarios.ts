/**
 * Pre-built simulator scenarios for the Developer Console.
 *
 * Each scenario is a thin wrapper around the kernel's `SimulationScenario`
 * shape — we tweak fields like priority, failures, treasury reserves, and
 * liquidity provider availability to produce the 10 canonical situations
 * developers want to test against.
 */
import type { SimulationScenario, FailureInjection } from '@/kernel';
import { defaultScenario } from '@/kernel';
import { uid } from '@/kernel/support';

export interface DeveloperScenario {
  id: string;
  label: string;
  description: string;
  category: 'payment' | 'payout' | 'refund' | 'settlement' | 'marketplace' | 'treasury' | 'lp' | 'stablecoin' | 'bank';
  build: () => SimulationScenario;
}

function fail(type: FailureInjection['type'], label: string, atFrame = 3, targetId?: string): FailureInjection {
  return { id: uid('fail'), type, label, atFrame, ...(targetId ? { targetId } : {}) };
}

/**
 * The 10 canonical developer scenarios.
 */
export const DEVELOPER_SCENARIOS: DeveloperScenario[] = [
  {
    id: 'payment_success',
    label: 'Payment Success',
    description: 'A standard cross-border mobile money payment that settles successfully end-to-end.',
    category: 'payment',
    build: () => defaultScenario(),
  },
  {
    id: 'payment_failed',
    label: 'Payment Failed',
    description: 'Payment blocked by policy — risk score above maxRiskScore threshold.',
    category: 'payment',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Payment Failed — risk block',
        description: 'Payment blocked by policy: risk score above maxRiskScore.',
        policies: { ...base.policies, maxRiskScore: 0.1 },
        transaction: { ...base.transaction, priority: 'fastest' },
      };
    },
  },
  {
    id: 'refund',
    label: 'Refund',
    description: 'Refund flow — original payment reversed, twin tokens burned, ledger unwound.',
    category: 'refund',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Refund — original payment reversed',
        description: 'Refund: original payment reversed, twin tokens burned.',
        transaction: {
          ...base.transaction,
          type: 'domestic',
          buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' },
          merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' },
          priority: 'safest',
        },
        treasury: {
          ...base.treasury,
          originReserve: { country: 'Ghana', currency: 'GHS', available: 100000, minThreshold: 10000 },
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 100000, minThreshold: 10000 },
        },
      };
    },
  },
  {
    id: 'payout',
    label: 'Payout',
    description: 'Merchant payout to a mobile money account — treasury draws reserve first.',
    category: 'payout',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Payout — merchant withdraws to mobile money',
        description: 'Merchant payout: treasury draws reserve first, then LP top-up.',
        transaction: {
          ...base.transaction,
          type: 'domestic',
          buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' },
          merchant: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' },
          priority: 'fastest',
        },
        treasury: { ...base.treasury, reservePolicy: 'reserve_first' },
      };
    },
  },
  {
    id: 'settlement',
    label: 'Settlement',
    description: 'Settlement with manual LP — recovery workflow triggered.',
    category: 'settlement',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Settlement — manual LP required',
        description: 'Settlement with manual LP: recovery workflow triggered.',
        liquidityProviders: base.liquidityProviders.map((lp, i) =>
          i === 0 ? { ...lp, manualOnly: true } : lp,
        ),
        transaction: { ...base.transaction, priority: 'balanced' },
      };
    },
  },
  {
    id: 'marketplace_auction',
    label: 'Marketplace Auction',
    description: 'Multiple LPs compete for the corridor; lowest-cost LP wins the auction.',
    category: 'marketplace',
    build: () => {
      const base = defaultScenario();
      // Add more LPs to simulate a competitive auction.
      const auctionLps = [
        ...base.liquidityProviders,
        {
          id: 'lp_auction_1',
          name: 'Diaspora Pool A',
          country: 'Kenya',
          currency: 'GHS' as const,
          sourceKind: 'diaspora_pool' as const,
          twinTokenPosition: 75000,
          fiatPosition: 150000,
          financialOperators: [],
          tradingFees: 0.7,
          tradingCapacity: 150000,
          riskProfile: 0.15,
          settlementSpeedMs: 45000,
          insuranceCoverage: 75000,
          availability: 0.98,
          historicalPerformance: 0.99,
          aiReputation: 0.9,
          manualOnly: false,
          online: true,
        },
        {
          id: 'lp_auction_2',
          name: 'Diaspora Pool B',
          country: 'Kenya',
          currency: 'GHS' as const,
          sourceKind: 'diaspora_pool' as const,
          twinTokenPosition: 100000,
          fiatPosition: 200000,
          financialOperators: [],
          tradingFees: 0.85,
          tradingCapacity: 200000,
          riskProfile: 0.18,
          settlementSpeedMs: 40000,
          insuranceCoverage: 100000,
          availability: 0.97,
          historicalPerformance: 0.98,
          aiReputation: 0.88,
          manualOnly: false,
          online: true,
        },
      ];
      return {
        ...base,
        name: 'Marketplace Auction — competitive LPs',
        description: 'Multiple LPs compete; lowest-cost LP wins the auction.',
        liquidityProviders: auctionLps,
        transaction: { ...base.transaction, priority: 'cheapest' },
      };
    },
  },
  {
    id: 'treasury_rebalance',
    label: 'Treasury Rebalance',
    description: 'Destination reserve below threshold — treasury rebalance triggered.',
    category: 'treasury',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Treasury Rebalance — destination reserve low',
        description: 'Destination reserve below threshold; treasury rebalance triggered.',
        treasury: {
          ...base.treasury,
          destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000, minThreshold: 10000 },
          reservePolicy: 'hybrid',
        },
        transaction: { ...base.transaction, priority: 'safest' },
      };
    },
  },
  {
    id: 'lp_timeout',
    label: 'LP Timeout',
    description: 'LP disappears mid-transaction; treasury bridge fallback kicks in.',
    category: 'lp',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'LP Timeout — treasury bridge fallback',
        description: 'LP disappears mid-transaction; treasury bridge fallback kicks in.',
        failures: [fail('lp_disappear', 'Acacia LP goes offline', 4, base.liquidityProviders[0]?.id)],
        transaction: { ...base.transaction, priority: 'fastest' },
      };
    },
  },
  {
    id: 'stablecoin_depeg',
    label: 'Stablecoin Depeg',
    description: 'FX spike causes twin-token depeg; insurance claim filed.',
    category: 'stablecoin',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Stablecoin Depeg — FX spike',
        description: 'FX spike causes twin-token depeg; insurance claim filed.',
        failures: [fail('fx_spike', 'KES/USD FX spike +12%', 3, 'KES')],
        transaction: { ...base.transaction, priority: 'safest' },
      };
    },
  },
  {
    id: 'bank_outage',
    label: 'Bank Outage',
    description: 'PSP timeout + network partition in buyer country; payment rerouted.',
    category: 'bank',
    build: () => {
      const base = defaultScenario();
      return {
        ...base,
        name: 'Bank Outage — PSP timeout + network partition',
        description: 'PSP timeout + network partition in buyer country; payment rerouted.',
        failures: [
          fail('psp_timeout', 'Banking PSP timeout', 2, 'fo-bank-gh'),
          fail('network_partition', 'Network partition Ghana', 3, 'Ghana'),
        ],
        transaction: { ...base.transaction, priority: 'balanced' },
      };
    },
  },
];

/**
 * Find a scenario by id.
 */
export function findScenario(id: string): DeveloperScenario | undefined {
  return DEVELOPER_SCENARIOS.find((s) => s.id === id);
}
