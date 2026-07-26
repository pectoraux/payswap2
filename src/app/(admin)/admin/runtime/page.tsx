import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
import { KernelRuntimeConsole } from '@/components/admin/kernel-runtime-console';
import { WorldSimulator } from '@/components/admin/world-simulator';
import { ScenarioBuilder } from '@/components/admin/scenario-builder';
import { Globe } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminRuntimePage() {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Globe className="h-6 w-6 text-emerald-500" />
          Runtime
        </h1>
        <p className="text-sm text-muted-foreground">
          Live kernel runtime, world simulator, and scenario builder for the
          PaySwap Financial Operating System.
        </p>
      </div>
      <WorldSimulator />
      <ScenarioBuilder />
      <KernelRuntimeConsole />
    </div>
  );
}
