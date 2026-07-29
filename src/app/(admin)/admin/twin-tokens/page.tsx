import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { runtime } from '@/runtime';
import {
  TwinTokensDashboard,
  type TwinTokenDTO,
  type CountryDTO,
} from './twin-tokens-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/twin-tokens — monetary policy dashboard.
 *
 * Visualizes the twin-token monetary model: supply, mint/burn activity,
 * reserve backing (fiat vs stablecoin), reserve ratio, circulation and
 * outstanding liabilities.
 *
 * Data sources:
 *   - runtime.ledger.getBalanceSheet() — canonical balance sheet
 *   - runtime.ledger.getProofOfTwinTokens() — backing proof
 *   - runtime.ledger.getSolvencyReport() — coverage ratios
 *   - runtime.controlPlane.buildDigitalTwin() — per-country twin token supply
 *   - runtime.twinTokens.list() — individual twin token positions (custodial wallets)
 *   - runtime.settlementContracts.list() — for daily mint/burn activity approximation
 */
export default async function TwinTokensPage() {
  await requireAdmin();

  const balanceSheet = runtime.ledger.getBalanceSheet();
  const proof = runtime.ledger.getProofOfTwinTokens();
  const solvency = runtime.ledger.getSolvencyReport();
  const twin = runtime.controlPlane.buildDigitalTwin();

  // All twin-token positions (custodial wallets).
  const positions = runtime.twinTokens.list();
  const twinTokens: TwinTokenDTO[] = positions.map((p) => ({
    accountId: p.accountId,
    tokenType: p.tokenType,
    currency: p.currency,
    balance: p.balance,
  }));

  // Approximate today's mint / burn activity from settlement contracts.
  // (Each created contract triggers a mint; each closed contract triggers a burn.)
  const now = Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;
  const recentContracts = runtime.settlementContracts
    .list()
    .filter((c) => c.createdAt >= dayStart);
  const mintedTodayCount = recentContracts.length;
  const mintedTodayAmount = recentContracts.reduce((s, c) => s + c.amount, 0);
  const closedToday = recentContracts.filter((c) => c.closedAt && c.closedAt >= dayStart);
  const burnedTodayCount = closedToday.length;
  const burnedTodayAmount = closedToday.reduce((s, c) => s + c.amount, 0);

  // Circulation = total supply in custodial wallets (claim tokens).
  const circulation = twinTokens
    .filter((t) => t.tokenType === 'claim')
    .reduce((s, t) => s + t.balance, 0);

  const countries: CountryDTO[] = twin.countries.map((c) => ({
    country: c.country,
    currency: c.currency,
    twinTokenSupply: c.twinTokenSupply,
    fiatReserves: c.fiatReserves,
    stablecoinReserves: c.stablecoinReserves,
    backingRatio: c.backingRatio,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Twin Token Dashboard"
        description="Monetary policy view of PaySwap's twin tokens — supply, mint/burn activity, reserve backing and circulation."
      />
      <TwinTokensDashboard
        totalSupply={proof.totalSupply}
        totalBacking={proof.totalBacking}
        backingRatio={proof.backingRatio}
        backedByFiat={proof.backedByFiat}
        backedByStablecoins={proof.backedByStablecoins}
        fiatBackingPct={
          proof.totalBacking > 0 ? proof.backedByFiat / proof.totalBacking : 0
        }
        stablecoinBackingPct={
          proof.totalBacking > 0 ? proof.backedByStablecoins / proof.totalBacking : 0
        }
        reserveRatio={solvency.twinCoverage}
        mintedTodayCount={mintedTodayCount}
        mintedTodayAmount={mintedTodayAmount}
        burnedTodayCount={burnedTodayCount}
        burnedTodayAmount={burnedTodayAmount}
        circulation={circulation}
        outstandingLiabilities={balanceSheet.liabilities.twinTokensOutstanding}
        twinTokenSupplyByCurrency={Object.entries(proof.twinTokenSupply).map(
          ([currency, amount]) => ({ currency, amount: amount as number }),
        )}
        positions={twinTokens}
        countries={countries}
      />
    </div>
  );
}
