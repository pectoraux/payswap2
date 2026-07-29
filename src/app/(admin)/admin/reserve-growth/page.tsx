import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { runtime } from '@/runtime';
import {
  ReserveGrowthDashboard,
  type CountryDTO,
} from './reserve-growth-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/reserve-growth — the story of PaySwap becoming sovereign.
 *
 * Visualizes the transition from stablecoin-backed to fiat-backed reserves:
 *   - Fiat vs stablecoin backing mix with the "100% fiat" target
 *   - Country coverage (fiat reserves vs stablecoin-only)
 *   - Reserve coverage (total reserves / total liabilities)
 *   - Reserve utilization (how much is being used)
 *   - Reserve velocity (linear growth projection)
 *   - Maturity distribution (count by maturity stage)
 */
export default async function ReserveGrowthPage() {
  await requireAdmin();

  const twin = runtime.controlPlane.buildDigitalTwin();
  const balanceSheet = runtime.ledger.getBalanceSheet();
  const solvency = runtime.ledger.getSolvencyReport();

  const countries: CountryDTO[] = twin.countries.map((c) => ({
    country: c.country,
    currency: c.currency,
    fiatReserves: c.fiatReserves,
    stablecoinReserves: c.stablecoinReserves,
    twinTokenSupply: c.twinTokenSupply,
    reserveCoverage: c.reserveCoverage,
    stablecoinDependency: c.stablecoinDependency,
    backingRatio: c.backingRatio,
    health: c.health,
    maturity: c.maturity,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reserve Growth"
        description="The story of PaySwap becoming sovereign — transitioning from stablecoin-backed to fiat-backed reserves."
      />
      <ReserveGrowthDashboard
        countries={countries}
        totalFiat={balanceSheet.assets.fiatReserves}
        totalStablecoins={balanceSheet.assets.stablecoinReserves}
        totalReserves={balanceSheet.assets.totalAssets}
        totalTwinTokens={balanceSheet.liabilities.twinTokensOutstanding}
        totalLiabilities={balanceSheet.liabilities.totalLiabilities}
        reserveCoverage={solvency.twinCoverage}
        solvencyRatio={solvency.solvencyRatio}
        lpExposure={solvency.lpExposure}
        settlementExposure={solvency.settlementExposure}
        fiatBackingPct={
          balanceSheet.assets.totalAssets > 0
            ? balanceSheet.assets.fiatReserves / balanceSheet.assets.totalAssets
            : 0
        }
        stablecoinBackingPct={
          balanceSheet.assets.totalAssets > 0
            ? balanceSheet.assets.stablecoinReserves / balanceSheet.assets.totalAssets
            : 0
        }
      />
    </div>
  );
}
