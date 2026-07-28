import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth-guards';
import { sdk } from '@/sdk';
import { SdkManager, type SdkPluginSummary, type SdkCapabilitySummary } from './sdk-manager';

export const dynamic = 'force-dynamic';

/**
 * /admin/sdk — Capability SDK dashboard.
 *
 * Shows registered plugins (with status + manifest drill-down) and a
 * capability browser. Admins can enable / disable plugins and invoke
 * capability methods from the UI.
 */
export default async function SdkAdminPage() {
  await requireAdmin();

  // Read the initial state directly from the SDK singleton. The manager
  // component refreshes via /api/sdk/* after each action.
  const records = sdk.list();
  const capabilities = sdk.registry.list();

  const plugins: SdkPluginSummary[] = records.map((r) => ({
    id: r.id,
    name: r.manifest.name,
    version: r.version,
    description: r.manifest.description,
    author: r.manifest.author,
    license: r.manifest.license ?? null,
    status: r.status,
    enabledAt: r.enabledAt ?? null,
    disabledAt: r.disabledAt ?? null,
    error: r.error ?? null,
    failureCount: sdk.sandbox.getFailureCount(r.id),
    manifest: r.manifest,
    store: sdk.storeSnapshot(r.id),
  }));

  const caps: SdkCapabilitySummary[] = capabilities.map(({ pluginId, capability }) => ({
    id: capability.id,
    name: capability.name,
    type: capability.type,
    config: capability.config ?? null,
    pluginId,
  }));

  const stats = {
    total: plugins.length,
    enabled: plugins.filter((p) => p.status === 'enabled').length,
    disabled: plugins.filter((p) => p.status === 'disabled').length,
    error: plugins.filter((p) => p.status === 'error').length,
    capabilities: caps.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capability SDK"
        description="Plugins extend the runtime without modifying the frozen kernel. Register, enable, and inspect capabilities."
      />
      <SdkManager plugins={plugins} capabilities={caps} stats={stats} />
    </div>
  );
}
