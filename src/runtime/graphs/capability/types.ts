/**
 * Capability Graph — what each network participant CAN do. (Final Amendment §7G;
 * refactored per the compiled-projection discipline.)
 *
 * THE KEY DISCIPLINE: the Capability Graph is a **compiled projection**, never
 * an authoritative data store. It is derived FROM source-of-truth inputs (LP
 * profiles, Connector Registry, Compliance Rules, Treasury permissions) by the
 * CapabilityCompiler. The graph can always be regenerated from those inputs +
 * the Domain Event log. It never owns business truth.
 *
 * Capabilities are not LP-only. Every network participant (LP, Treasury,
 * Reserve Pool, Bank, Stablecoin Vault, CBDC Gateway, FX Provider, Connector,
 * Liquidity Pool) has capabilities. The graph is universal.
 */

import type { Rail } from '../../engines/liquidity-market/types';
export type { Rail } from '../../engines/liquidity-market/types';

/** The kinds of participants that can own capabilities. */
export type CapabilityOwnerType =
  | 'lp'
  | 'treasury'
  | 'reserve_pool'
  | 'bank'
  | 'stablecoin_vault'
  | 'cbdc_gateway'
  | 'fx_provider'
  | 'connector'
  | 'liquidity_pool';

/** FX mode: how the capability handles currency conversion. */
export type FXMode = 'none' | 'direct' | 'bridged' | 'hopped';

/** A cost curve: fee as a function of utilization tier. */
export interface CostCurveTier {
  /** [low, high] utilization bounds (0..1). */
  utilizationRange: [number, number];
  /** Fee in basis points for this tier. */
  feeBps: number;
}

/**
 * A capability — a single edge one participant can perform.
 *
 * This is the enriched type the Financial Compiler reasons over. It carries
 * everything the compiler needs to plan settlement: what assets, what network,
 * what method, what limits, what compliance region, what FX mode, whether
 * reserves/collateral are required, the risk score, the cost curve, priority,
 * and availability.
 */
export interface LPCapability {
  id: string;

  // ── Owner (not LP-only) ──────────────────────────────────────────────
  ownerId: string;
  ownerType: CapabilityOwnerType;

  // ── Assets + route ───────────────────────────────────────────────────
  /** Source asset (e.g. 'GHS', 'TwinGHS', 'USDC'). */
  from: string;
  /** Destination asset (e.g. 'TwinGHS', 'XOF', 'KES'). */
  to: string;
  rail: Rail;

  // ── Settlement ───────────────────────────────────────────────────────
  /** Settlement network (e.g. 'stellar', 'mtn_momo', 'bank rail', 'visa'). */
  settlementNetwork: string;
  /** Settlement method (e.g. 'instant', 'batch', 'manual', 'rtgs'). */
  settlementMethod: string;
  latencyMs: number;

  // ── Limits ───────────────────────────────────────────────────────────
  maxAmount: number;
  minAmount: number;

  // ── Compliance + risk ────────────────────────────────────────────────
  /** Compliance region (e.g. 'KE', 'GH', 'NG', 'ECOWAS', 'EAC'). */
  complianceRegion: string;
  fxMode: FXMode;
  reserveRequired: boolean;
  collateralRequired: boolean;
  /** Risk score 0..1 (lower = safer). */
  riskScore: number;

  // ── Economics ────────────────────────────────────────────────────────
  /** Utilization-tiered cost curve (fee varies by utilization). */
  costCurve: CostCurveTier[];
  /** Priority (higher = preferred when all else equal). */
  priority: number;
  /** Availability 0..1 (probability the capability is usable when queried). */
  availability: number;

  // ── State ────────────────────────────────────────────────────────────
  active: boolean;
  /** When this capability was (re)compiled. */
  compiledAt: number;
}

/** The Capability Graph — a compiled projection. Source of truth for "what's possible" RIGHT NOW. */
export interface CapabilityGraph {
  /** All capabilities of one owner. */
  forOwner(ownerId: string): LPCapability[];
  /** All capabilities that can move from→to (directly). */
  canMove(from: string, to: string): LPCapability[];
  /** All active capabilities. */
  all(): LPCapability[];
  /** Replace the entire graph (called by the CapabilityCompiler on rebuild). */
  replaceAll(capabilities: LPCapability[]): void;
}

/** In-memory Capability Graph (a compiled projection). */
export class InMemoryCapabilityGraph implements CapabilityGraph {
  private byId: Map<string, LPCapability> = new Map();

  forOwner(ownerId: string): LPCapability[] {
    return [...this.byId.values()].filter((c) => c.ownerId === ownerId && c.active);
  }

  canMove(from: string, to: string): LPCapability[] {
    return [...this.byId.values()].filter(
      (c) => c.active && c.from === from && c.to === to,
    );
  }

  all(): LPCapability[] {
    return [...this.byId.values()].filter((c) => c.active);
  }

  replaceAll(capabilities: LPCapability[]): void {
    this.byId.clear();
    for (const cap of capabilities) {
      this.byId.set(cap.id, cap);
    }
  }
}
