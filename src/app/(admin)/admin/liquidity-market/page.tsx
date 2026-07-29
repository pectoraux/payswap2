import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { runtime } from '@/runtime';
import { bandwidthEngine, settlementContractEngine } from '@/runtime/liquidity';
import type { BandwidthPosition } from '@/runtime/liquidity';
import {
  LiquidityMarketViewer,
  type BandwidthDTO,
  type SettlementContractDTO,
  type CountryDTO,
  type CorridorDTO,
} from './liquidity-market-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/liquidity-market — Bloomberg-style liquidity market dashboard.
 *
 * Visualizes every LP bandwidth position, marketplace depth per corridor,
 * stablecoin inventory, reserve coverage per country and the pending
 * settlement queue — in one dense, color-coded view.
 */
export default async function LiquidityMarketPage() {
  await requireAdmin();

  const twin = runtime.controlPlane.buildDigitalTwin();
  const balanceSheet = runtime.ledger.getBalanceSheet();
  const contracts = settlementContractEngine.list();
  const bandwidth = bandwidthEngine.listAll();

  const bandwidthDTO: BandwidthDTO[] = bandwidth.map((b) => ({
    lpId: b.lpId,
    country: b.country,
    assetType: b.assetType,
    currency: b.currency,
    capacity: b.capacity,
    reserved: b.reserved,
    used: b.used,
    available: b.available,
    escrow: b.escrow,
    bond: b.bond,
    status: b.status,
    participationMode: b.participationMode,
    debitAuthorized: b.debitAuthorization?.authorized ?? false,
    debitConnector: b.debitAuthorization?.connector ?? null,
  }));

  const contractDTO: SettlementContractDTO[] = contracts.map((c) => ({
    id: c.id,
    status: c.status,
    fromCountry: c.fromCountry,
    toCountry: c.toCountry,
    fromCurrency: c.fromCurrency,
    toCurrency: c.toCurrency,
    amount: c.amount,
    escrowAmount: c.escrowAmount,
    escrowCurrency: c.escrowCurrency,
    lpId: c.lpId,
    recipientId: c.recipientId,
    createdAt: c.createdAt,
    fundedAt: c.fundedAt,
    claimedAt: c.claimedAt,
    confirmedAt: c.confirmedAt,
    releasedAt: c.releasedAt,
    closedAt: c.closedAt,
    expiresAt: c.expiresAt,
    strategy: c.strategy,
  }));

  const countryDTO: CountryDTO[] = twin.countries.map((c) => ({
    country: c.country,
    currency: c.currency,
    fiatReserves: c.fiatReserves,
    stablecoinReserves: c.stablecoinReserves,
    twinTokenSupply: c.twinTokenSupply,
    reserveCoverage: c.reserveCoverage,
    backingRatio: c.backingRatio,
    health: c.health,
  }));

  const corridorDTO: CorridorDTO[] = twin.corridors.map((co) => ({
    from: co.from,
    to: co.to,
    demand: co.demand,
    supply: co.supply,
    cost: co.cost,
    latency: co.latency,
    health: co.health,
  }));

  const pendingContracts = contracts.filter(
    (c) => !['closed', 'expired'].includes(c.status),
  );
  const settlementQueueValue = pendingContracts.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidity Market"
        description="Global LP map, marketplace depth, reserve coverage and the pending settlement queue — Bloomberg-style."
      />
      <LiquidityMarketViewer
        bandwidth={bandwidthDTO}
        contracts={contractDTO}
        countries={countryDTO}
        corridors={corridorDTO}
        totalBandwidth={twin.totalBandwidth}
        totalStablecoins={twin.totalStablecoins}
        totalReserves={twin.totalReserves}
        totalTwinTokens={twin.totalTwinTokens}
        settlementQueueCount={pendingContracts.length}
        settlementQueueValue={settlementQueueValue}
        fiatReserves={balanceSheet.assets.fiatReserves}
        stablecoinReserves={balanceSheet.assets.stablecoinReserves}
      />
    </div>
  );
}

// Re-export BandwidthPosition type so other dashboards can share it if needed.
export type { BandwidthPosition };
