import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime } from '@/runtime';
import { PageHeader } from '@/components/page-header';
import {
  ControlCenterViewer,
  type CountryDTO,
  type RecommendationDTO,
} from './control-center-viewer';

export const dynamic = 'force-dynamic';

/**
 * /treasury/control-center — Bloomberg-style reserve control center.
 *
 * Replaces the simple treasury overview with a rich dashboard that visualizes:
 *   - Reserve utilization (fiat vs stablecoin) per country
 *   - Stablecoin inventory by country
 *   - Twin token backing ratio gauge
 *   - Reserve forecasts (linear projection from current data)
 *   - Rebalance recommendations from runtime.controlPlane
 */
export default async function TreasuryControlCenterPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as { roles?: string[] })?.roles ?? [];
  if (!roles.some((r) => ['TREASURY', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }

  // Pull the live digital twin + balance sheet + control-plane recommendations.
  const twin = runtime.controlPlane.buildDigitalTwin();
  const balanceSheet = runtime.ledger.getBalanceSheet();
  const proof = runtime.ledger.getProofOfTwinTokens();
  const report = runtime.controlPlane.getReport();

  const countries: CountryDTO[] = twin.countries.map((c) => ({
    country: c.country,
    currency: c.currency,
    fiatReserves: c.fiatReserves,
    stablecoinReserves: c.stablecoinReserves,
    twinTokenSupply: c.twinTokenSupply,
    bandwidth: c.bandwidth,
    activeLPs: c.activeLPs,
    reserveCoverage: c.reserveCoverage,
    stablecoinDependency: c.stablecoinDependency,
    backingRatio: c.backingRatio,
    health: c.health,
    maturity: c.maturity,
  }));

  const recommendations: RecommendationDTO[] = [
    ...report.capitalAllocations.map((a) => ({
      kind: 'capital' as const,
      id: a.allocationId,
      action: a.action,
      country: a.country,
      currency: a.currency,
      amount: a.amount,
      reason: a.reason,
      expectedROI: a.expectedROI,
      expectedRisk: a.expectedRisk,
      confidence: a.confidence,
      approvalClass: a.approvalClass,
    })),
    ...report.inventoryRecommendations.map((r, i) => ({
      kind: 'inventory' as const,
      id: `inv-${i}`,
      action: r.action,
      country: r.asset,
      currency: '',
      amount: r.amount,
      reason: r.reason,
      expectedROI: 0,
      expectedRisk: 0,
      confidence: 0,
      approvalClass: 'automatic' as const,
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Treasury Control Center"
        description="Real-time reserves, twin-token backing and rebalance recommendations across every country."
      />
      <ControlCenterViewer
        countries={countries}
        totalFiat={balanceSheet.assets.fiatReserves}
        totalStablecoins={balanceSheet.assets.stablecoinReserves}
        totalReserves={balanceSheet.assets.totalAssets}
        twinTokenSupply={balanceSheet.liabilities.twinTokensOutstanding}
        backingRatio={proof.backingRatio}
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
        recommendations={recommendations}
        reserveEvolution={report.reserveEvolution.map((e) => ({
          country: e.country,
          currentMaturity: e.currentMaturity,
          targetMaturity: e.targetMaturity,
          fiatRatio: e.fiatRatio,
          stablecoinRatio: e.stablecoinRatio,
          evolutionProgress: e.evolutionProgress,
          recommendedActions: e.recommendedActions,
        }))}
      />
    </div>
  );
}
