/**
 * PaySwap Kernel — public entry point.
 *
 * Re-exports the 21 engines and the simulation runner, plus a default
 * scenario that mirrors the canonical Kenya → Ghana corridor used in the
 * kernel spec. Milestone-1 services, extensions and products all import
 * from here.
 */
export * from './types';
export { KERNEL_VERSION, CURRENCIES, COUNTRY_FLAGS, formatMoney, formatDuration, round } from './support';
export { ENGINES, ENGINE_COUNT } from './registry';
export { simulationEngine } from './simulation';
export { SimulationEngine } from './simulation';
export { RoutingEngine } from './routing';
export { SettlementEngine } from './settlement';
export { LedgerEngine } from './ledger';
export { ReserveEngine } from './reserve';
export { LiquidityEngine } from './liquidity';
export { TwinTokenEngine } from './twin-token';
export { FxEngine, fxEngine } from './fx';
export { PricingEngine, pricingEngine } from './pricing';
export { RiskEngine, riskEngine } from './risk';
export { ComplianceEngine, complianceEngine } from './compliance';
export { FraudEngine, fraudEngine } from './fraud';
export { TreasuryEngine, treasuryEngine } from './treasury';
export { AIAgentEngine, aiAgentEngine } from './ai-agent';
export { PolicyEngine, policyEngine } from './policy';
export { PermissionEngine, permissionEngine } from './permission';
export { AuditEngine, auditEngine } from './audit';
export { EventEngine, eventEngine } from './event';
export { WorkflowEngine, workflowEngine } from './workflow';
export { ExtensionRuntime, extensionRuntime } from './extension';
export { TransactionEngine } from './transaction';

import type { SimulationScenario } from './types';

/**
 * The canonical corridor used to demonstrate the kernel:
 *   Buyer (Kenya, M-Pesa) → Merchant (Ghana, Bank), 25,000 GHS.
 * Kenya reserve empty → bridge liquidity sourced from 3 Kenyan LPs.
 * Default preference "cheapest" yields LP2 (0.8%) then LP1 (1.1%),
 * reproducing the spec's reference output.
 */
export function defaultScenario(): SimulationScenario {
  return {
    buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', label: 'Buyer' },
    merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', label: 'Merchant' },
    amount: 25000,
    currency: 'GHS',
    reserves: [
      { country: 'Ghana', currency: 'GHS', balance: 100000, minThreshold: 10000 },
      { country: 'Kenya', currency: 'KES', balance: 0, minThreshold: 0 },
    ],
    liquidityProviders: [
      { id: '1', country: 'Kenya', currency: 'GHS', capacity: 50000, rate: 1.1, speedMs: 52000 },
      { id: '2', country: 'Kenya', currency: 'GHS', capacity: 10000, rate: 0.8, speedMs: 44000 },
      { id: '3', country: 'Kenya', currency: 'GHS', capacity: 250000, rate: 1.4, speedMs: 61000 },
    ],
    preference: 'cheapest',
  };
}

/** Countries + currencies the simulator UI offers. */
export const COUNTRY_OPTIONS: { country: string; currency: import('./types').CurrencyCode; methods: string[] }[] = [
  { country: 'Kenya', currency: 'KES', methods: ['M-Pesa', 'Bank Transfer', 'Airtel Money'] },
  { country: 'Ghana', currency: 'GHS', methods: ['Mobile Money', 'Bank Transfer', 'Hubtel'] },
  { country: 'Nigeria', currency: 'NGN', methods: ['Bank Transfer', 'USSD', 'Paystack'] },
  { country: 'South Africa', currency: 'ZAR', methods: ['EFT', 'Bank Transfer', 'Yoco'] },
  { country: 'Uganda', currency: 'UGX', methods: ['MTN MoMo', 'Bank Transfer'] },
  { country: 'Tanzania', currency: 'TZS', methods: ['M-Pesa', 'Tigo Pesa', 'Bank Transfer'] },
];
