/**
 * Capability Graph seed — bridges the existing kernel LiquidityProvider data
 * to the new CapabilityCompiler inputs. (M-RT-2 transitional.)
 *
 * This is a transitional adapter: it converts kernel LiquidityProvider objects
 * into LPProfile source-of-truth inputs, then the CapabilityCompiler derives
 * capabilities from them. Eventually seedCapabilitiesFromKernel() disappears
 * and the compiler reads directly from the LP Profile store.
 */

import type { LiquidityProvider } from '../../../kernel/types';
import type { LPProfile, ConnectorEntry } from './sources';
import type { CapabilityCompilerInput } from './compiler';

/** Map a country code to its local currency code. */
export function localCurrencyFor(country: string): string | null {
  const map: Record<string, string> = {
    Kenya: 'KES',
    Ghana: 'GHS',
    Nigeria: 'NGN',
    Senegal: 'XOF',
    'Côte d\'Ivoire': 'XOF',
    Uganda: 'UGX',
    Tanzania: 'TZS',
    Rwanda: 'RWF',
    Togo: 'XOF',
    'South Africa': 'ZAR',
  };
  return map[country] ?? null;
}

/** Convert a kernel LiquidityProvider into an LPProfile (source-of-truth input). */
export function lpProfileFromKernel(lp: LiquidityProvider): LPProfile {
  const localCurrency = localCurrencyFor(lp.country) ?? lp.currency;
  return {
    id: lp.id,
    name: lp.name,
    country: lp.country,
    currency: lp.currency,
    localCurrency,
    tradingCapacity: lp.tradingCapacity,
    settlementSpeedMs: lp.settlementSpeedMs,
    rail: lp.sourceKind === 'cooperative_pool' ? 'bank' : 'mobile_money',
    complianceRegions: [lp.country],
    riskProfile: lp.riskProfile,
    availability: lp.availability,
    online: lp.online,
    connectorIds: [],
    reserveAccess: [],
    fxModes: ['direct'],
    costCurve: [
      { utilizationRange: [0, 0.4], feeBps: Math.round(lp.tradingFees * 100) },
      { utilizationRange: [0.4, 0.7], feeBps: Math.round(lp.tradingFees * 130) },
      { utilizationRange: [0.7, 0.95], feeBps: Math.round(lp.tradingFees * 200) },
      { utilizationRange: [0.95, 1.01], feeBps: Math.round(lp.tradingFees * 400) },
    ],
  };
}

/**
 * Build a CapabilityCompilerInput from kernel LP data.
 * (Transitional — eventually the compiler reads directly from the LP Profile store.)
 */
export function compilerInputFromKernel(lps: LiquidityProvider[]): CapabilityCompilerInput {
  return {
    lpProfiles: lps.map(lpProfileFromKernel),
    connectors: [] as ConnectorEntry[],
    complianceRules: [],
    treasuryPermissions: lps.map((lp) => ({
      ownerId: lp.id,
      mayRequireReserve: true,
      mayRequireCollateral: false,
    })),
  };
}
