import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { economicOS } from '@/economic-os';
import { EconomicOSViewer, type EconomicOSDTO } from './economic-os-viewer';

export const dynamic = 'force-dynamic';

export default async function EconomicOSPage() {
  await requireAdmin();
  const intents = economicOS.listIntents();
  const assets = economicOS.listAssets();
  const actors = economicOS.listActors();
  const capabilities = economicOS.listCapabilities();
  const graphs = economicOS.listGraphs(10);
  const settlements = economicOS.listSettlements(10);
  const overview = economicOS.overview();
  const dto: EconomicOSDTO = {
    intents: intents.map((i) => ({ ...i, createdAt: new Date(i.createdAt).toISOString() })),
    assets,
    actors: actors.map((a) => ({
      id: a.id, name: a.name, version: a.version, status: a.status,
      category: a.category, description: a.description,
      reputation: a.reputation, trustScore: a.trustScore,
      treasury: a.treasury,
      revenue: a.revenue, costs: a.costs, profit: a.profit,
      balanceSheetAssets: a.balanceSheetAssets, balanceSheetLiabilities: a.balanceSheetLiabilities,
      invocations: a.invocations, successfulInvocations: a.successfulInvocations,
      failedInvocations: a.failedInvocations, avgLatencyMs: a.avgLatencyMs,
      registeredAt: new Date(a.registeredAt).toISOString(),
      contracts: a.contracts,
    })),
    capabilities,
    graphs: graphs.map((g) => ({
      id: g.id, intentId: g.intentId, intentName: g.intentName,
      nodes: g.nodes, edges: g.edges,
      totalCost: g.totalCost, totalLatencyMs: g.totalLatencyMs, trustScore: g.trustScore,
      actorCount: g.actorCount, opportunisticCount: g.opportunisticCount,
      status: g.status, policyViolations: g.policyViolations,
      compiledAt: new Date(g.compiledAt).toISOString(),
    })),
    settlements: settlements.map((s) => ({
      id: s.id, graphId: s.graphId, intentId: s.intentId, intentName: s.intentName,
      steps: s.steps.map((st) => ({ ...st, ts: new Date(st.ts).toISOString() })),
      status: s.status, totalRevenue: s.totalRevenue, totalCost: s.totalCost,
      startedAt: new Date(s.startedAt).toISOString(),
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null,
      durationMs: s.durationMs,
    })),
    overview,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Operating System"
        description="The compiler is the heart. Extensions are autonomous businesses (actors) that declare only Produces, Consumes, Capabilities, Policies — no direct coupling. Users express Intent; the compiler discovers the composition DAG; the settlement kernel executes it and records P&L. Payments are just one kind of economic intent."
      />
      <EconomicOSViewer initial={dto} />
    </div>
  );
}
