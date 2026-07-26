/**
 * Capability Graph seed — populates initial capabilities from the existing
 * kernel LiquidityProvider data. (M-RT-2.)
 *
 * Derives a sensible initial capability set from each LP's country/currency.
 * For the canonical Kenya→Ghana scenario, LPs in Kenya with GHS currency
 * get capabilities like KES→TwinGHS and TwinGHS→GHS.
 */

import type { LiquidityProvider } from '../../../kernel/types';
import type { PublishableCapability } from './service';
import type { Rail } from '../../engines/liquidity-market/types';
import type { Environment } from '../../types';

/**
 * Derive initial capabilities for an LP based on its country + currency.
 *
 * Convention: an LP in country X offering currency Y can move:
 *   <local currency of X> → Twin<Y>   (mint-side)
 *   Twin<Y> → <Y>                       (redeem-side)
 *
 * For the canonical Kenya LPs offering GHS, this produces:
 *   KES → TwinGHS   (Acacia, Baobab, Cooperative)
 *   TwinGHS → GHS   (Acacia, Baobab, Cooperative)
 */
export function deriveCapabilitiesFromLP(lp: LiquidityProvider): PublishableCapability[] {
  const caps: PublishableCapability[] = [];
  const localCurrency = localCurrencyFor(lp.country);
  const twinCurrency = `Twin${lp.currency}`;
  const rail: Rail = lp.sourceKind === 'cooperative_pool' ? 'bank' : 'mobile_money';

  // local → Twin<currency>  (the LP takes local funds and issues a twin token)
  if (localCurrency && localCurrency !== lp.currency) {
    caps.push({
      lpId: lp.id,
      from: localCurrency,
      to: twinCurrency,
      rail,
      maxAmount: lp.tradingCapacity,
      latencyMs: lp.settlementSpeedMs,
    });
  }

  // Twin<currency> → currency  (the LP redeems the twin token for fiat)
  caps.push({
    lpId: lp.id,
    from: twinCurrency,
    to: lp.currency,
    rail,
    maxAmount: lp.tradingCapacity,
    latencyMs: lp.settlementSpeedMs,
  });

  return caps;
}

/** Map a country code to its local currency code. */
function localCurrencyFor(country: string): string | null {
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

/**
 * Seed the Capability Graph from kernel LP data.
 * Returns the capabilities that would be published (the caller publishes them).
 */
export function seedCapabilitiesFromKernel(
  lps: LiquidityProvider[],
  environment: Environment,
): { capabilities: PublishableCapability[]; environment: Environment } {
  const capabilities: PublishableCapability[] = [];
  for (const lp of lps) {
    if (!lp.online) continue;
    capabilities.push(...deriveCapabilitiesFromLP(lp));
  }
  return { capabilities, environment };
}
