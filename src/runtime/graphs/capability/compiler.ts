/**
 * CapabilityCompiler — the ONLY producer of the Capability Graph.
 * (Compiled-projection discipline.)
 *
 * The Capability Graph is a compiled projection, never an authoritative data
 * store. This compiler derives capabilities FROM source-of-truth inputs (LP
 * profiles, Connector Registry, Compliance Rules, Treasury permissions) and
 * replaces the graph on every rebuild. The graph can always be regenerated.
 *
 * Convention (same as the original seed, now formalized):
 *   An LP in country X offering currency Y gets:
 *     <localCurrency of X> → Twin<Y>   (mint-side: takes local funds, issues twin token)
 *     Twin<Y> → <Y>                      (redeem-side: redeems twin token for fiat)
 *
 * Future: this compiler becomes continuous (rebuilds on every source change).
 */

import type {
  LPCapability,
  CapabilityGraph,
  CostCurveTier,
} from './types';
import type {
  LPProfile,
  ConnectorEntry,
  ComplianceRule,
  TreasuryPermission,
} from './sources';

/** Inputs to the CapabilityCompiler. */
export interface CapabilityCompilerInput {
  lpProfiles: LPProfile[];
  connectors: ConnectorEntry[];
  complianceRules: ComplianceRule[];
  treasuryPermissions: TreasuryPermission[];
  /** Include treasury/reserve-pool capabilities (not just LPs). */
  treasuryProfile?: LPProfile;
}

/** The CapabilityCompiler — derives capabilities from source-of-truth inputs. */
export class CapabilityCompiler {
  /**
   * Compile source-of-truth inputs into a set of capabilities.
   * Returns the full derived capability set (the caller replaces the graph).
   */
  compile(input: CapabilityCompilerInput, compiledAt: number): LPCapability[] {
    const capabilities: LPCapability[] = [];

    // Derive LP capabilities.
    for (const lp of input.lpProfiles) {
      if (!lp.online) continue;
      const lpCapabilities = this.deriveLPCapabilities(lp, input, compiledAt);
      // Filter out capabilities blocked by compliance rules.
      for (const cap of lpCapabilities) {
        const blocked = input.complianceRules.some((rule) => {
          try {
            return rule.blocks({
              ownerId: cap.ownerId,
              ownerType: cap.ownerType,
              from: cap.from,
              to: cap.to,
              complianceRegion: cap.complianceRegion,
            });
          } catch {
            return false;
          }
        });
        if (!blocked) capabilities.push(cap);
      }
    }

    // Derive treasury capabilities (if provided).
    if (input.treasuryProfile) {
      const treasuryCaps = this.deriveLPCapabilities(
        { ...input.treasuryProfile, id: 'treasury', name: 'Treasury' },
        input,
        compiledAt,
        'treasury',
      );
      capabilities.push(...treasuryCaps);
    }

    return capabilities;
  }

  /** Derive capabilities for one LP (or treasury-as-LP). */
  private deriveLPCapabilities(
    lp: LPProfile,
    input: CapabilityCompilerInput,
    compiledAt: number,
    ownerTypeOverride?: 'treasury',
  ): LPCapability[] {
    const caps: LPCapability[] = [];
    const twinCurrency = `Twin${lp.currency}`;
    const ownerType = ownerTypeOverride ?? 'lp';
    const permission = input.treasuryPermissions.find((p) => p.ownerId === lp.id);

    // local → Twin<currency>  (mint-side)
    if (lp.localCurrency && lp.localCurrency !== lp.currency) {
      caps.push(this.buildCapability({
        ownerId: lp.id,
        ownerType,
        from: lp.localCurrency,
        to: twinCurrency,
        rail: lp.rail,
        settlementNetwork: this.resolveNetwork(lp, input.connectors),
        settlementMethod: 'instant',
        latencyMs: lp.settlementSpeedMs,
        maxAmount: lp.tradingCapacity,
        minAmount: 1,
        complianceRegion: lp.complianceRegions[0] ?? lp.country,
        fxMode: lp.fxModes[0] ?? 'direct',
        reserveRequired: permission?.mayRequireReserve ?? true,
        collateralRequired: permission?.mayRequireCollateral ?? false,
        riskScore: lp.riskProfile,
        costCurve: lp.costCurve,
        priority: ownerType === 'treasury' ? 50 : 100,  // LPs preferred over treasury fallback
        availability: lp.availability,
        compiledAt,
      }));
    }

    // Twin<currency> → currency  (redeem-side)
    caps.push(this.buildCapability({
      ownerId: lp.id,
      ownerType,
      from: twinCurrency,
      to: lp.currency,
      rail: lp.rail,
      settlementNetwork: this.resolveNetwork(lp, input.connectors),
      settlementMethod: 'instant',
      latencyMs: lp.settlementSpeedMs,
      maxAmount: lp.tradingCapacity,
      minAmount: 1,
      complianceRegion: lp.complianceRegions[0] ?? lp.country,
      fxMode: lp.fxModes[0] ?? 'direct',
      reserveRequired: permission?.mayRequireReserve ?? true,
      collateralRequired: permission?.mayRequireCollateral ?? false,
      riskScore: lp.riskProfile,
      costCurve: lp.costCurve,
      priority: ownerType === 'treasury' ? 50 : 100,
      availability: lp.availability,
      compiledAt,
    }));

    return caps;
  }

  private buildCapability(params: {
    ownerId: string;
    ownerType: 'lp' | 'treasury';
    from: string;
    to: string;
    rail: import('./types').LPCapability['rail'];
    settlementNetwork: string;
    settlementMethod: string;
    latencyMs: number;
    maxAmount: number;
    minAmount: number;
    complianceRegion: string;
    fxMode: import('./types').FXMode;
    reserveRequired: boolean;
    collateralRequired: boolean;
    riskScore: number;
    costCurve: { utilizationRange: [number, number]; feeBps: number }[];
    priority: number;
    availability: number;
    compiledAt: number;
  }): LPCapability {
    return {
      id: `cap_${params.ownerId}_${params.from}_${params.to}`,
      ownerId: params.ownerId,
      ownerType: params.ownerType,
      from: params.from,
      to: params.to,
      rail: params.rail,
      settlementNetwork: params.settlementNetwork,
      settlementMethod: params.settlementMethod,
      latencyMs: params.latencyMs,
      maxAmount: params.maxAmount,
      minAmount: params.minAmount,
      complianceRegion: params.complianceRegion,
      fxMode: params.fxMode,
      reserveRequired: params.reserveRequired,
      collateralRequired: params.collateralRequired,
      riskScore: params.riskScore,
      costCurve: params.costCurve as CostCurveTier[],
      priority: params.priority,
      availability: params.availability,
      active: true,
      compiledAt: params.compiledAt,
    };
  }

  /** Resolve the settlement network from the LP's connected connectors. */
  private resolveNetwork(lp: LPProfile, connectors: ConnectorEntry[]): string {
    if (lp.connectorIds.length === 0) return 'internal';
    const connector = connectors.find((c) => c.id === lp.connectorIds[0] && c.online);
    return connector?.settlementNetwork ?? 'internal';
  }

  /**
   * Rebuild the graph from source-of-truth inputs (replaces the entire graph).
   * This is the "POST /compiler/rebuild-capabilities" operation.
   */
  rebuild(graph: CapabilityGraph, input: CapabilityCompilerInput, compiledAt: number): LPCapability[] {
    const capabilities = this.compile(input, compiledAt);
    graph.replaceAll(capabilities);
    return capabilities;
  }
}
