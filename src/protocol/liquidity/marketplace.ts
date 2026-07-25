/**
 * PaySwap Protocol — Liquidity Marketplace.
 *
 * LPs are NOT balances. LPs provide settlement capacity.
 *
 * The planner asks:
 *   "Which available actor has the highest probability of completing this transition?"
 *
 * NOT:
 *   "Who has the biggest balance?"
 *
 * LP capacity = Capacity × Confidence × Availability × Exposure Lease
 * Never use reported bank balances directly as routing liquidity.
 */
import {
  type Entity, type Evidence,
  createEntity,
} from '@/kernel';
import { uid, round } from '@/kernel/support';
import { lpLifecycle, type LPRecord } from '../lp-lifecycle-manager';
import { settlementCapacityVault } from '../settlement/capacity-vault';
import { collateralVault } from '../settlement/collateral-vault';
import { computeAuthorizedExposure, defaultExposureFactors, type ExposureFactors } from '../economics/authorized-exposure';

export interface LPProfile {
  id: string;
  name: string;
  jurisdiction: string;
  currencies: string[];
  settlementSpeedMs: number;
  capacity: number;
  reputation: number;
  historicalSuccess: number;
  manualOnly: boolean;
  online: boolean;
  feeBps: number;
}

export interface LPCapacityQuote {
  lpId: string;
  totalCapacity: number;
  availableCapacity: number;
  authorizedExposure: number;
  currentExposure: number;
  remainingExposure: number;
  confidence: number;
  effectiveCapacity: number;
  utilization: number;
}

export class LiquidityMarketplace {
  private profiles: Map<string, LPProfile> = new Map();

  /** Register an LP in the marketplace. */
  registerLP(profile: LPProfile): LPProfile {
    this.profiles.set(profile.id, profile);
    return profile;
  }

  /** Get all active LPs for a currency. */
  activeLPsForCurrency(currency: string): LPProfile[] {
    return [...this.profiles.values()].filter(
      (lp) => lp.online && lp.currencies.includes(currency),
    );
  }

  /** Quote capacity for an LP — uses Capacity × Confidence × Availability × Exposure. */
  quoteCapacity(lpId: string, evidence: Evidence[], confidence: number): LPCapacityQuote | null {
    const profile = this.profiles.get(lpId);
    const lpRecord = lpLifecycle.get(lpId);
    if (!profile || !lpRecord || lpRecord.state !== 'active') return null;

    const stakedCapacity = settlementCapacityVault.capacityByLp(lpId, profile.currencies[0]);
    const availableExposure = lpRecord.authorizedExposure - lpRecord.currentExposure;

    // Effective capacity = min(staked capacity, available exposure) × confidence × availability
    const rawCapacity = Math.min(stakedCapacity, availableExposure);
    const effectiveCapacity = round(rawCapacity * confidence * profile.historicalSuccess, 2);

    return {
      lpId,
      totalCapacity: stakedCapacity,
      availableCapacity: availableExposure,
      authorizedExposure: lpRecord.authorizedExposure,
      currentExposure: lpRecord.currentExposure,
      remainingExposure: round(availableExposure, 2),
      confidence,
      effectiveCapacity,
      utilization: lpRecord.authorizedExposure > 0 ? round(lpRecord.currentExposure / lpRecord.authorizedExposure, 4) : 0,
    };
  }

  /** Quote all LPs for a currency — sorted by effective capacity (highest first). */
  quoteAll(currency: string, evidence: Evidence[], confidenceFn: (lpId: string) => number): LPCapacityQuote[] {
    const lps = this.activeLPsForCurrency(currency);
    const quotes = lps
      .map((lp) => this.quoteCapacity(lp.id, evidence, confidenceFn(lp.id)))
      .filter((q): q is LPCapacityQuote => q !== null);
    return quotes.sort((a, b) => b.effectiveCapacity - a.effectiveCapacity);
  }

  /** Get the best LP for a specific amount. */
  findBestLP(currency: string, amount: number, evidence: Evidence[], confidenceFn: (lpId: string) => number): LPCapacityQuote | null {
    const quotes = this.quoteAll(currency, evidence, confidenceFn);
    return quotes.find((q) => q.effectiveCapacity >= amount) ?? null;
  }

  /** Update LP profile (online status, fees, etc.). */
  updateProfile(lpId: string, updates: Partial<LPProfile>): LPProfile | null {
    const profile = this.profiles.get(lpId);
    if (!profile) return null;
    Object.assign(profile, updates);
    return profile;
  }

  getProfile(lpId: string): LPProfile | undefined { return this.profiles.get(lpId); }
  allProfiles(): LPProfile[] { return [...this.profiles.values()]; }

  reset(): void { this.profiles.clear(); }
}

export const liquidityMarketplace = new LiquidityMarketplace();
