import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { runtime } from '@/runtime';
import { bandwidthEngine } from '@/runtime/liquidity';
import {
  CompilerExplorer,
  type CountryDTO,
  type BandwidthDTO,
} from './compiler-explorer';

export const dynamic = 'force-dynamic';

/**
 * /admin/compiler-explorer — flagship demo of the Economic Compiler.
 *
 * Visualizes the entire settlement pipeline for a payment, from intent
 * through strategy selection, reserve graph, marketplace, LP selection,
 * twin tokens, settlement and confirmation. Operators can play with the
 * inputs and watch the policy engine re-compile the plan live.
 *
 * The page server-renders the initial digital twin + bandwidth state and
 * passes it to the client component. The client component then imports
 * `liquidityPolicyEngine` directly (it's a pure function) and re-compiles
 * the plan whenever the form changes.
 */
export default async function CompilerExplorerPage() {
  await requireAdmin();

  const twin = runtime.controlPlane.buildDigitalTwin();
  const bandwidth = bandwidthEngine.listAll();

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
    bandwidth: c.bandwidth,
    activeLPs: c.activeLPs,
  }));

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
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Compiler Explorer"
        description="Compile a payment end-to-end and watch the settlement pipeline unfold — strategy, reserves, marketplace, LPs, twin tokens, settlement."
      />
      <CompilerExplorer countries={countries} bandwidth={bandwidthDTO} />
    </div>
  );
}
