import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-guards';
import { KernelRuntimeConsole } from '@/components/admin/kernel-runtime-console';
import { WorldSimulator } from '@/components/admin/world-simulator';

export const dynamic = 'force-dynamic';

export default async function AdminRuntimePage() {
  const ctx = await requireAdmin().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  return (
    <div className="space-y-6">
      <WorldSimulator />
      <KernelRuntimeConsole />
    </div>
  );
}
