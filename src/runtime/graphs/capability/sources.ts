/**
 * Source-of-truth inputs to the CapabilityCompiler. (Compiled-projection discipline.)
 *
 * These are the AUTHORITATIVE data stores. The Capability Graph is a compiled
 * projection derived from these — it never owns business truth. When any of
 * these change, the compiler regenerates the graph.
 */

import type { CapabilityOwnerType, FXMode, Rail } from './types';

/** An LP Profile — the source of truth for an LP's capabilities. */
export interface LPProfile {
  id: string;
  name: string;
  country: string;
  currency: string;            // the currency the LP offers (e.g. 'GHS')
  localCurrency: string;       // the LP's local currency (e.g. 'KES')
  tradingCapacity: number;
  settlementSpeedMs: number;
  rail: Rail;
  /** Compliance regions this LP can serve. */
  complianceRegions: string[];
  riskProfile: number;         // 0..1
  availability: number;        // 0..1
  online: boolean;
  /** Connected connector IDs. */
  connectorIds: string[];
  /** Reserve access grants (reserve pool IDs the LP can draw from). */
  reserveAccess: string[];
  /** FX modes the LP supports. */
  fxModes: FXMode[];
  /** Default cost curve (utilization-tiered fees). */
  costCurve: { utilizationRange: [number, number]; feeBps: number }[];
}

/** A Connector Registry entry — the source of truth for a connector. */
export interface ConnectorEntry {
  id: string;
  name: string;
  type: 'mobile_money' | 'bank' | 'card' | 'stablecoin' | 'blockchain';
  countries: string[];
  currencies: string[];
  settlementNetwork: string;
  settlementMethod: string;
  latencyMs: number;
  maxAmount: number;
  minAmount: number;
  online: boolean;
}

/** A Compliance Rule — gates which capabilities are allowed. */
export interface ComplianceRule {
  id: string;
  /** If true, this rule blocks the capability. */
  blocks: (cap: { ownerId: string; ownerType: string; from: string; to: string; complianceRegion: string }) => boolean;
  reason: string;
}

/** Treasury permission — whether an owner may require reserves/collateral. */
export interface TreasuryPermission {
  ownerId: string;
  mayRequireReserve: boolean;
  mayRequireCollateral: boolean;
}
