import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { economicEngine } from '@/economic-engine';
import { ResolveViewer, type EconomicEngineDTO } from './resolve-viewer';

export const dynamic = 'force-dynamic';

export default async function ResolvePage() {
  await requireAdmin();
  const goals = economicEngine.listGoals().map((g) => ({ ...g, createdAt: new Date(g.createdAt).toISOString() }));
  const organizations = economicEngine.listOrganizations();
  const proofs = economicEngine.listProofs(10);
  const memory = economicEngine.listMemory(30);
  const cooperation = economicEngine.listCooperation();
  const strategies = economicEngine.listStrategyEffectiveness();
  const reliability = economicEngine.listOrganizationReliability();
  const overview = economicEngine.overview();
  const dto: EconomicEngineDTO = {
    goals,
    organizations: organizations.map((o) => ({
      id: o.id, name: o.name, legalName: o.legalName, version: o.version, status: o.status,
      category: o.category, description: o.description,
      produces: o.produces, consumes: o.consumes, capabilities: o.capabilities, policies: o.policies,
      treasury: o.treasury,
      revenue: o.revenue, costs: o.costs, profit: o.profit, profitTarget: o.profitTarget,
      balanceSheetAssets: o.balanceSheetAssets, balanceSheetLiabilities: o.balanceSheetLiabilities,
      reputation: o.reputation, trustScore: o.trustScore,
      objectives: o.objectives, governance: o.governance,
      workforceSize: o.workforceSize, reserveRequirement: o.reserveRequirement,
      invocations: o.invocations, successfulInvocations: o.successfulInvocations,
      failedInvocations: o.failedInvocations, avgLatencyMs: o.avgLatencyMs, carbonPerInvocation: o.carbonPerInvocation,
      registeredAt: new Date(o.registeredAt).toISOString(),
    })),
    proofs: proofs.map((p) => ({
      id: p.id, goalId: p.goalId, goalName: p.goalName, strategy: p.strategy,
      strategyRationale: p.strategyRationale,
      nodes: p.nodes, edges: p.edges,
      totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore,
      carbon: p.carbon, risk: p.risk,
      organizationCount: p.organizationCount, opportunisticCount: p.opportunisticCount,
      plannerScore: p.plannerScore, scoreBreakdown: p.scoreBreakdown,
      status: p.status,
      verification: p.verification ? { ...p.verification, verifiedAt: new Date(p.verification.verifiedAt).toISOString() } : undefined,
      memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
      createdAt: new Date(p.createdAt).toISOString(),
    })),
    memory: memory.map((m) => ({ ...m, executedAt: new Date(m.executedAt).toISOString() })),
    cooperation, strategies, reliability, overview,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="General-Purpose Economic Computation Engine"
        description="The universal resolve() — compiles high-level goals into verified networks of autonomous economic organizations exchanging typed assets under explicit constraints + policies. Payments are just one specialization. resolve(goal, constraints, policies) → EconomicProof[]"
      />
      <ResolveViewer initial={dto} />
    </div>
  );
}
