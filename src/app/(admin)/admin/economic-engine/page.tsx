import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { economicEngine } from '@/economic';
import { EconomicEngineViewer, type EconomicEngineDTO } from './economic-engine-viewer';

export const dynamic = 'force-dynamic';

function serializeToken(t: ReturnType<typeof economicEngine.listTokens>[number]) {
  return { ...t };
}
function serializeBalance(b: ReturnType<typeof economicEngine.balances>[number]) {
  return { ...b, updatedAt: new Date(b.updatedAt).toISOString() };
}
function serializeOp(o: ReturnType<typeof economicEngine.operations>[number]) {
  return { ...o, ts: new Date(o.ts).toISOString() };
}
function serializeExt(e: ReturnType<typeof economicEngine.listExtensions>[number]) {
  return {
    id: e.id, name: e.name, version: e.version, status: e.status,
    category: e.category, description: e.description, reputation: e.reputation,
    treasury: e.treasury,
    eventsPublished: e.eventsPublished, eventsConsumed: e.eventsConsumed,
    tokensMinted: e.tokensMinted, tokensConsumed: e.tokensConsumed,
    registeredAt: new Date(e.registeredAt).toISOString(),
    manifest: e.manifest,
  };
}
function serializePipeline(p: ReturnType<typeof economicEngine.listPipelines>[number]) {
  return {
    id: p.id, name: p.name, description: p.description, trigger: p.trigger,
    filter: p.filter, steps: p.steps, status: p.status,
    executions: p.executions, successes: p.successes, failures: p.failures,
    lastExecutedAt: p.lastExecutedAt ? new Date(p.lastExecutedAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}
function serializeExec(e: ReturnType<typeof economicEngine.listExecutions>[number]) {
  return {
    id: e.id, pipelineId: e.pipelineId, pipelineName: e.pipelineName, trigger: e.trigger,
    triggerEvent: { type: e.triggerEvent.type, source: e.triggerEvent.source, payload: e.triggerEvent.payload, ts: new Date(e.triggerEvent.ts).toISOString() },
    steps: e.steps.map((s) => ({ ...s, ts: new Date(s.ts).toISOString() })),
    status: e.status,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
    durationMs: e.durationMs,
    cascadeDepth: e.cascadeDepth,
  };
}
function serializeEvent(e: ReturnType<typeof economicEngine.listEvents>[number]) {
  return { ...e, ts: new Date(e.ts).toISOString() };
}

export default async function EconomicEnginePage() {
  await requireAdmin();
  const graph = economicEngine.buildGraph();
  const dto: EconomicEngineDTO = {
    tokens: economicEngine.listTokens().map(serializeToken),
    balances: economicEngine.balances({}).map(serializeBalance),
    operations: economicEngine.operations({ limit: 80 }).map(serializeOp),
    extensions: economicEngine.listExtensions().map(serializeExt),
    pipelines: economicEngine.listPipelines().map(serializePipeline),
    executions: economicEngine.listExecutions({ limit: 50 }).map(serializeExec),
    events: economicEngine.listEvents({ limit: 80 }).map(serializeEvent),
    graph,
    overview: economicEngine.overview(),
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Composition Engine"
        description="Extensions are autonomous economic actors. They exchange standardized tokens and events — never calling each other directly. Every new extension increases the value of the existing ecosystem."
      />
      <EconomicEngineViewer initial={dto} />
    </div>
  );
}
