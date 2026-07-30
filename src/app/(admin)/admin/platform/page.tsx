import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { platform } from '@/economic-platform';
import { PlatformViewer, type PlatformDTO } from './platform-viewer';

export const dynamic = 'force-dynamic';

export default async function PlatformPage() {
  await requireAdmin();
  const capabilities = platform.listCapabilities();
  const providers = platform.listProviders();
  const assetTypes = platform.listAssetTypes();
  const goals = platform.listGoals();
  const memory = platform.listMemory(30);
  const learning = platform.listLearningScores();
  const graph = platform.buildGraph();
  const overview = platform.overview();
  const dto: PlatformDTO = {
    capabilities, providers, assetTypes, goals,
    memory: memory.map((m) => ({ ...m, executedAt: new Date(m.executedAt).toISOString() })),
    learning, graph, overview,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Computation Platform"
        description="Capabilities are the primitive — everything else is emergent. Organizations, AI models, humans, APIs, banks, government, and blockchains all compete as providers on the same capabilities. The graph is the only data structure. resolve(goal) → graph search → market optimization → proof → settlement → learning."
      />
      <PlatformViewer initial={dto} />
    </div>
  );
}
