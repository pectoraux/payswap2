/**
 * GET /api/sdk/plugins — list all registered plugins.
 *
 * Admin-only. Returns the list of registered plugin records with their
 * status, manifest summary, and capability count.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { sdk } from '@/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Admin-only — callers must hold ADMIN or SUPER_ADMIN.
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const records = sdk.list();
  const capabilities = sdk.registry.list();
  const capByPlugin = new Map<string, number>();
  for (const c of capabilities) {
    capByPlugin.set(c.pluginId, (capByPlugin.get(c.pluginId) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    count: records.length,
    plugins: records.map((r) => ({
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
      capabilityCount: capByPlugin.get(r.id) ?? 0,
      declaredCapabilityCount: r.manifest.capabilities.length,
      permissionCount: r.manifest.permissions.length,
      commandCount: r.manifest.commands.length,
      eventHandlerCount: r.manifest.events.length,
      viewCount: r.manifest.views.length,
      policyCount: r.manifest.policies.length,
      dependencyCount: r.manifest.dependencies.length,
      migrationCount: r.manifest.migrations.length,
      failureCount: sdk.sandbox.getFailureCount(r.id),
    })),
  });
}
