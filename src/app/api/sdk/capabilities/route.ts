/**
 * GET /api/sdk/capabilities — list all registered capabilities.
 *
 * Admin-only. Optionally filter by `?type=<CapabilityType>`.
 *
 * Returns the list of capabilities currently registered in the
 * CapabilityRegistry (i.e. capabilities from enabled plugins only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { sdk } from '@/sdk';
import type { CapabilityType } from '@/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: CapabilityType[] = [
  'settlement-rail', 'wallet', 'compliance', 'identity', 'analytics',
  'fraud-detection', 'corridor-optimizer', 'pricing-engine', 'country',
  'stablecoin', 'twin-token', 'marketplace-algorithm', 'ai-director',
  'notification', 'custom',
];

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')) return forbidden();

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type');
  const type = typeParam as CapabilityType | null;

  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid capability type "${typeParam}". Valid: ${VALID_TYPES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const items = type ? sdk.capabilities(type) : sdk.capabilities();

  // Resolve the providing plugin's status for the UI.
  const records = new Map(sdk.list().map((r) => [r.id, r]));

  return NextResponse.json({
    ok: true,
    count: items.length,
    filter: type ? { type } : null,
    capabilities: items.map(({ pluginId, capability }) => ({
      id: capability.id,
      name: capability.name,
      type: capability.type,
      config: capability.config ?? null,
      pluginId,
      pluginStatus: records.get(pluginId)?.status ?? 'unknown',
      pluginVersion: records.get(pluginId)?.version ?? null,
    })),
  });
}
