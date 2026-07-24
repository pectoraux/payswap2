/**
 * PaySwap Runtime — Entity Model.
 *
 * Every object in the financial world derives from a single common type:
 * Entity. Reserves, LPs, merchants, treasuries, customers, wallets, twin
 * tokens, insurance pools, financial operators, countries, banks, PSPs,
 * loans, invoices, governance proposals, extensions, AI agents — they all
 * differ only in capabilities.
 *
 *   Entity {
 *     id, type, state,
 *     attributes,      // type-specific data
 *     relationships,   // edges to other entities
 *     capabilities,    // what this entity can do
 *     policies,        // rules governing this entity
 *     metadata         // provenance, versioning, audit
 *   }
 *
 * This dramatically simplifies the runtime: one storage model, one query
 * model, one serialization model, one event model — for every financial
 * object that will ever exist.
 */
import type { CurrencyCode, LiquiditySourceKind, FinancialOperatorType } from './types';
import { uid } from './support';

/**
 * Entity type is a free-form string — the kernel doesn't know what types exist.
 * PaySwap defines 'reserve', 'lp', 'merchant', etc.
 * Supply chain defines 'container', 'truck', 'warehouse', etc.
 * The kernel only cares about capabilities, not types.
 */
export type EntityType = string;

export type EntityState = string; // free-form — governed by state machines

export interface EntityRelationship {
  type: string;        // e.g. 'holds', 'operates_in', 'backs', 'connected_to'
  targetId: string;
  targetype?: EntityType;
  weight?: number;
}

export interface EntityCapabilities {
  canDebit?: boolean;
  canCredit?: boolean;
  canMint?: boolean;
  canBurn?: boolean;
  canStake?: boolean;
  canTrade?: boolean;
  canWithdraw?: boolean;
  canSettle?: boolean;
  canVote?: boolean;
  canBridge?: boolean;
  canConvert?: boolean;
  canSwap?: boolean;
  canTransfer?: boolean;
  canReceive?: boolean;
  canRefund?: boolean;
  canBorrow?: boolean;
  canLend?: boolean;
  canInsure?: boolean;
  canClaim?: boolean;
  manualOnly?: boolean;
}

export interface EntityPolicies {
  maxDrawdown?: number;
  minThreshold?: number;
  feeBps?: number;
  riskCap?: number;
  concentrationCap?: number;
  custom?: Record<string, unknown>;
}

export interface EntityMetadata {
  createdAt: number;
  updatedAt: number;
  version: number;
  createdBy: string;
  tags: string[];
}

export interface Entity {
  id: string;
  type: EntityType;
  state: EntityState;
  label: string;
  country?: string;
  currency?: CurrencyCode;
  balance: number;
  attributes: Record<string, unknown>;
  relationships: EntityRelationship[];
  capabilities: EntityCapabilities;
  policies: EntityPolicies;
  metadata: EntityMetadata;
}

/** Factory: create a new Entity with sensible defaults. */
export function createEntity(
  type: EntityType,
  label: string,
  init: Partial<Entity> = {},
): Entity {
  return {
    id: init.id ?? uid(type),
    type,
    state: init.state ?? 'created',
    label,
    country: init.country,
    currency: init.currency,
    balance: init.balance ?? 0,
    attributes: init.attributes ?? {},
    relationships: init.relationships ?? [],
    capabilities: init.capabilities ?? {},
    policies: init.policies ?? {},
    metadata: init.metadata ?? {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      createdBy: 'system',
      tags: [],
    },
  };
}

/** Convert a scenario's reserves/LPs/FOs/treasury into Entities. */
export function entitiesFromScenario(scenario: import('./types').SimulationScenario): Entity[] {
  const entities: Entity[] = [];

  // Countries
  entities.push(createEntity('country', scenario.transaction.buyer.country, { id: `country:${scenario.transaction.buyer.country}`, state: 'active', balance: 0, attributes: { currency: scenario.transaction.buyer.currency } }));
  entities.push(createEntity('country', scenario.transaction.merchant.country, { id: `country:${scenario.transaction.merchant.country}`, state: 'active', balance: 0, attributes: { currency: scenario.transaction.merchant.currency } }));

  // Reserves
  entities.push(createEntity('reserve', `Reserve ${scenario.treasury.originReserve.country}`, {
    id: `reserve:${scenario.treasury.originReserve.country}`,
    state: 'healthy',
    country: scenario.treasury.originReserve.country,
    currency: scenario.treasury.originReserve.currency,
    balance: scenario.treasury.originReserve.available,
    capabilities: { canDebit: true, canCredit: true },
    policies: { minThreshold: scenario.treasury.originReserve.minThreshold },
    attributes: { locked: 0, forecast: 0 },
  }));
  entities.push(createEntity('reserve', `Reserve ${scenario.treasury.destinationReserve.country}`, {
    id: `reserve:${scenario.treasury.destinationReserve.country}`,
    state: 'healthy',
    country: scenario.treasury.destinationReserve.country,
    currency: scenario.treasury.destinationReserve.currency,
    balance: scenario.treasury.destinationReserve.available,
    capabilities: { canDebit: true, canCredit: true },
    policies: { minThreshold: scenario.treasury.destinationReserve.minThreshold },
    attributes: { locked: 0, forecast: 0 },
  }));

  // LPs
  for (const lp of scenario.liquidityProviders) {
    entities.push(createEntity('lp', lp.name, {
      id: `lp:${lp.id}`,
      state: lp.online ? 'active' : 'inactive',
      country: lp.country,
      currency: lp.currency,
      balance: lp.tradingCapacity,
      capabilities: { canStake: true, canTrade: true, canWithdraw: true, canBridge: true, canSettle: !lp.manualOnly, manualOnly: lp.manualOnly },
      policies: { feeBps: lp.tradingFees * 100, riskCap: lp.riskProfile },
      attributes: {
        sourceKind: lp.sourceKind,
        twinTokenPosition: lp.twinTokenPosition,
        fiatPosition: lp.fiatPosition,
        settlementSpeedMs: lp.settlementSpeedMs,
        insuranceCoverage: lp.insuranceCoverage,
        availability: lp.availability,
        historicalPerformance: lp.historicalPerformance,
        aiReputation: lp.aiReputation,
      },
    }));
  }

  // Treasury
  entities.push(createEntity('treasury', 'Stablecoin Treasury', {
    id: 'treasury:stablecoin',
    state: 'active',
    currency: scenario.transaction.merchant.currency,
    balance: scenario.treasury.stablecoinBalance,
    capabilities: { canDebit: true, canCredit: true, canConvert: true, canSwap: true, canMint: true, canBurn: true },
    attributes: { emergencyBalance: scenario.treasury.emergencyTreasury },
  }));

  // Financial Operators
  for (const fo of scenario.financialOperators) {
    entities.push(createEntity('financial_operator', fo.name, {
      id: `fo:${fo.id}`,
      state: fo.online ? 'active' : 'inactive',
      country: fo.country,
      balance: fo.maxAmount,
      capabilities: { canDebit: true, canCredit: true, manualOnly: fo.manualOnly },
      policies: { feeBps: fo.feeBps },
      attributes: {
        foType: fo.type,
        latencyMs: fo.latencyMs,
        uptime: fo.uptime,
        failureRate: fo.failureRate,
        maxAmount: fo.maxAmount,
        minAmount: fo.minAmount,
        supportedRoutes: fo.supportedRoutes,
        supportedCurrencies: fo.supportedCurrencies,
      },
    }));
  }

  // Wallets
  entities.push(createEntity('wallet', 'Buyer Wallet', {
    id: 'wallet:buyer',
    state: 'active',
    country: scenario.transaction.buyer.country,
    currency: scenario.transaction.buyer.currency,
    balance: scenario.transaction.amount,
    capabilities: { canDebit: true },
  }));
  entities.push(createEntity('wallet', 'Merchant Wallet', {
    id: 'wallet:merchant',
    state: 'active',
    country: scenario.transaction.merchant.country,
    currency: scenario.transaction.merchant.currency,
    balance: 0,
    capabilities: { canCredit: true },
  }));

  // Insurance pool
  entities.push(createEntity('insurance_pool', 'Insurance Pool', {
    id: 'insurance:pool',
    state: 'active',
    currency: scenario.transaction.merchant.currency,
    balance: scenario.treasury.emergencyTreasury * 0.5,
    capabilities: { canCredit: true },
  }));

  return entities;
}

/** Entity type display metadata. */
/**
 * Entity metadata registry — domains register their entity types.
 * The kernel provides a default for unknown types.
 */
export const ENTITY_META: Record<string, { label: string; icon: string; color: string }> = {
  // PaySwap types (registered by the PaySwap domain)
  reserve: { label: 'Reserve', icon: '🏦', color: 'text-amber-500' },
  lp: { label: 'Liquidity Provider', icon: '💧', color: 'text-emerald-500' },
  merchant: { label: 'Merchant', icon: '🏪', color: 'text-rose-500' },
  customer: { label: 'Customer', icon: '👤', color: 'text-sky-500' },
  wallet: { label: 'Wallet', icon: '👛', color: 'text-sky-500' },
  treasury: { label: 'Treasury', icon: '🏛️', color: 'text-violet-500' },
  stablecoin: { label: 'Stablecoin', icon: '🪙', color: 'text-violet-500' },
  twin_token: { label: 'Twin Token', icon: '🪙', color: 'text-amber-500' },
  insurance_pool: { label: 'Insurance Pool', icon: '🛡️', color: 'text-rose-500' },
  financial_operator: { label: 'Financial Operator', icon: '🔌', color: 'text-teal-500' },
  country: { label: 'Country', icon: '🌍', color: 'text-sky-500' },
  bank: { label: 'Bank', icon: '🏦', color: 'text-sky-500' },
  psp: { label: 'PSP', icon: '💳', color: 'text-teal-500' },
  loan: { label: 'Loan', icon: '📄', color: 'text-orange-500' },
  invoice: { label: 'Invoice', icon: '📋', color: 'text-orange-500' },
  governance_proposal: { label: 'Governance Proposal', icon: '⚖️', color: 'text-fuchsia-500' },
  extension: { label: 'Extension', icon: '🧩', color: 'text-lime-500' },
  ai_agent: { label: 'AI Agent', icon: '🤖', color: 'text-fuchsia-500' },
  bridge: { label: 'Bridge', icon: '🌉', color: 'text-cyan-500' },
  fx_corridor: { label: 'FX Corridor', icon: '💱', color: 'text-cyan-500' },
};

/** Register entity metadata for a domain (e.g., supply chain). */
export function registerEntityMeta(type: string, meta: { label: string; icon: string; color: string }): void {
  ENTITY_META[type] = meta;
}

/** Get entity metadata with a default for unknown types. */
export function getEntityMeta(type: string): { label: string; icon: string; color: string } {
  return ENTITY_META[type] ?? { label: type, icon: '📦', color: 'text-muted-foreground' };
}
